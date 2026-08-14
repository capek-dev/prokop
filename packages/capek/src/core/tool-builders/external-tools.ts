import { tool, jsonSchema } from 'ai';
import { getTool } from '../../tools/registry';
import { executeTool } from '../../tools/executor';
import { createLlmApi } from '../../tools/llm-api';
import { createWorkspaceCapability } from '../../tools/workspace-capability';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '../../tools/ask-user-api';
import { getToolWorkspaceHost } from '../../runtime/host-dependencies';
import { transitionToolToRunningByCallId } from '../../storage/runtime';
import { interruptManager } from '../interrupt';
import {
  canSpawnSubagent,
  executeSubagent,
  getSubagentToolDefinition,
  type SubagentInput,
  type SubagentOutput,
} from '../subagent';
import { truncateToolResult } from '../../utils/truncate-tool-result';
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
  const shouldIncludeTask = canSpawnSubagent(sessionId) && !toolNames.includes('task') && canSpawn;
  const allowedSubagentIds = Array.isArray(canSpawnSubagents) ? canSpawnSubagents : undefined;
  const subagentDefinition = shouldIncludeTask
    ? await getSubagentToolDefinition({
      sessionId,
      canSpawnSubagents,
      allowSelfAsSubagent,
    })
    : null;
  const builtInAgentTools = subagentDefinition ? ['task'] : [];
  const effectiveToolNames = [...toolNames, ...builtInAgentTools];

  for (const name of effectiveToolNames) {
    if (name === 'task') {
      if (!subagentDefinition) continue;

      tools[name] = tool({
        description: subagentDefinition.description,
        inputSchema: jsonSchema(subagentDefinition.inputSchema),
        execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          const toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);

          try {
            const subagentInput: SubagentInput = {
              description: args.description as string,
              prompt: args.prompt as string,
              subagent_type: args.subagent_type as string,
              task_id: args.task_id as string | undefined,
              sessionId,
              workspaceId,
              workspacePath,
              abortSignal: toolAbortController.signal,
              onSessionCreated: (childSessionId: string) => {
                const updatedPart = transitionToolToRunningByCallId(sessionId, toolCallId, childSessionId);
                if (updatedPart) {
                  broadcast({ type: 'part.updated', sessionId, part: updatedPart });
                }
              },
              allowedSubagentIds,
              ...(args.outputSchema ? { outputSchema: args.outputSchema as Record<string, unknown> } : {}),
            };

            const result = await executeSubagent(subagentInput);
            return result as SubagentOutput;
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
          }
        },
      });
      continue;
    }

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
              : (() => { throw new Error('Cannot ask user: no broadcast channel available (broadcastFn not provided)'); }) as import('@jean2/sdk').AskApi;

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

          const toolOutput = truncateToolResult(result.result, sessionId, name, workspace.tempDir);

          if (result.visualization && toolOutput && typeof toolOutput === 'object') {
            return { ...toolOutput as Record<string, unknown>, _visualization: result.visualization };
          }

          return toolOutput;
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  return tools;
}
