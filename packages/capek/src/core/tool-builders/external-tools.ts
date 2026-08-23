import { tool, jsonSchema } from 'ai';
import { getTool } from '../../tools/registry';
import { executeTool } from '../../tools/executor';
import { createLlmApi } from '../../tools/llm-api';
import { createWorkspaceCapability } from '../../workspace/policy';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '../../permission/ask-user-api';
import { getToolWorkspaceHost } from '../../runtime/host-dependencies';
import { transitionToolToRunningByCallId } from '../../storage/runtime';
import { interruptManager } from '../interrupt';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  mergeDomainToolVisualization,
  type DomainToolPayload,
} from '../../runtime/domain-tool-source';
import { isToolAllowedInContext, type ToolExecutionScope } from '../tool-capabilities';
import type { ToolMap } from './types';
import type { BroadcastFn } from '../../runtime/host-dependencies';

export interface ExternalToolsOptions {
  toolNames: string[];
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  broadcastFn?: AskBroadcastFn;
  broadcast: BroadcastFn;
  sessionId: string;
  workspaceId: string | undefined;
  workspacePath: string | undefined;
  rootSessionId: string;
  executionScopes: ReadonlySet<ToolExecutionScope>;
  modelId?: string;
  providerId?: string;
  additionalPaths?: string[];
}

export async function buildExternalTools(options: ExternalToolsOptions): Promise<ToolMap> {
  const {
    toolNames,
    canSpawnSubagents,
    allowSelfAsSubagent,
    broadcastFn,
    broadcast,
    sessionId,
    workspaceId,
    workspacePath,
    rootSessionId,
    executionScopes,
    modelId,
    providerId,
    additionalPaths,
  } = options;

  const tools: ToolMap = {};

  const canSpawn = canSpawnSubagents === true
    || (Array.isArray(canSpawnSubagents) && canSpawnSubagents.length > 0);
  const allowedSubagentIds = Array.isArray(canSpawnSubagents) ? canSpawnSubagents : undefined;

  // The task tool is owned by the C5 subagent domain plugin. Composed scopes
  // provide its payload through the generic contributed-domain-tool seam;
  // the unscoped path uses the explicitly installed legacy fallback. The
  // domain owns the depth gate (isEnabled); the preconfig spawn policy and
  // the 'task'-name guard stay here because they arrive per build.
  const scopedDomainPayloads = getContributedDomainToolPayloads();
  const taskPayload: DomainToolPayload | null = scopedDomainPayloads === null
    ? getDomainToolFallback('task')
    : scopedDomainPayloads.get('task') ?? null;
  const shouldIncludeTask = taskPayload !== null
    && !toolNames.includes('task')
    && canSpawn
    && await taskPayload.isEnabled?.(workspaceId ?? '', sessionId) === true;

  // Phase 1a: registry tools in toolNames order, exactly as pre-C5.
  for (const name of toolNames) {
    const loadedTool = await getTool(name);
    if (!loadedTool) continue;

    const { definition } = loadedTool;

    if (!isToolAllowedInContext(definition.capabilities, executionScopes)) {
      continue;
    }

    tools[name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);

        try {
          const llmFactory = () => createLlmApi(modelId, providerId, sessionId);
          const askFactory = (tcId: string) =>
            broadcastFn
              ? createAskApi(sessionId, tcId, definition.name, broadcastFn, workspaceId, rootSessionId)
              : (() => { throw new Error('Cannot ask user: no broadcast channel available (broadcastFn not provided)'); }) as import('@capekai/tool').AskApi;

          const workspace = createWorkspaceCapability(getToolWorkspaceHost({
            workspaceId,
            workspacePath,
            additionalPaths,
            sessionId,
          }));
          const result = await executeTool({
            tool: loadedTool,
            args,
            workspace,
            sessionId,
            workspaceId,
            toolCallId,
            abortSignal: toolAbortController.signal,
            timeout: definition.timeout,
            createLlmApi: llmFactory,
            createAskApi: askFactory,
          });

          if (!result.success) {
            return { error: result.error ?? 'Tool execution failed' };
          }

          if (result.visualization && result.result && typeof result.result === 'object') {
            return { ...result.result as Record<string, unknown>, _visualization: result.visualization };
          }

          return result.result;
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // Phase 1b: the task tool after the registry tools, preserving the exact
  // pre-C5 build order. The dynamic description and schema come from the
  // payload's per-build resolver (composed deps or the legacy fallback).
  if (shouldIncludeTask && taskPayload) {
    const taskDefinition = await taskPayload.resolveDefinition?.(sessionId, {
      canSpawnSubagents,
      allowSelfAsSubagent,
    });
    if (taskDefinition) {
      tools['task'] = tool({
        description: taskDefinition.description,
        inputSchema: jsonSchema(taskDefinition.inputSchema),
        execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          const toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);

          try {
            return await taskPayload.execute(args, {
              workspaceId: workspaceId ?? '',
              sessionId,
              ask: async () => {
                throw new Error('Cannot ask user: no broadcast channel available (broadcastFn not provided)');
              },
              workspacePath,
              abortSignal: toolAbortController.signal,
              onSessionCreated: async (childSessionId: string) => {
                const updatedPart = await transitionToolToRunningByCallId(sessionId, toolCallId, childSessionId);
                if (updatedPart) {
                  broadcast({ kind: 'part', action: 'updated', sessionId, part: updatedPart });
                }
              },
              allowedSubagentIds,
              broadcast,
            }).then((result) => mergeDomainToolVisualization(taskPayload, args, result));
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
          }
        },
      });
    }
  }

  return tools;
}
