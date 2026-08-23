import { tool, jsonSchema } from 'ai';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  mergeDomainToolVisualization,
  type DomainToolPayload,
} from '../../runtime/domain-tool-source';
import { getWorkspace } from '../../storage/runtime';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '../../permission/ask-user-api';
import { interruptManager } from '../interrupt';
import type { WorkflowInput } from '@capekai/types';
import type { PermissionRiskLevel } from '@capekai/tool';
import type { ToolMap } from './types';

export interface WorkspaceToolsOptions {
  workspaceId: string;
  workspacePath: string;
  rootSessionId: string;
  sessionId: string;
  canSpawn: boolean;
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  allowedSubagentIds?: string[];
  broadcastFn?: AskBroadcastFn;
  agentId?: string | null;
  allowedSkills?: string[] | null;
  agentSkillsDir?: string;
}

export async function buildWorkspaceTools(options: WorkspaceToolsOptions): Promise<ToolMap> {
  const {
    workspaceId,
    workspacePath,
    rootSessionId,
    sessionId,
    canSpawn,
    canSpawnSubagents,
    allowSelfAsSubagent,
    broadcastFn,
    agentId,
    allowedSkills,
    agentSkillsDir,
  } = options;

  const tools: ToolMap = {};
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return tools;

  // The generic contributed-domain-tool payload map is resolved once and
  // shared by the skill, memory, workflow, skill_manage, session_search,
  // and scheduler builders: null means the unscoped path (registered
  // fallbacks may apply), an empty map means a composed scope without
  // domain payloads (fallbacks disabled).
  const scopedDomainPayloads = getContributedDomainToolPayloads();
  const domainPayload = (name: string): DomainToolPayload | null =>
    scopedDomainPayloads === null
      ? getDomainToolFallback(name)
      : scopedDomainPayloads.get(name) ?? null;

  // ── Skill tool ────────────────────────────────────────────
  if (workspacePath) {
    const skillPayload = domainPayload('skill');
    const skillDefinition = await skillPayload?.resolveDefinition?.(sessionId, {
      workspacePath,
      allowedSkills,
      agentSkillsDir,
    });
    if (skillPayload && skillDefinition) {
      tools['skill'] = tool({
        description: skillDefinition.description,
        inputSchema: jsonSchema(skillDefinition.inputSchema),
        execute: async (args: Record<string, unknown>) =>
          skillPayload.execute(args, {
            workspaceId,
            sessionId,
            ask: async () => {
              throw new Error('Cannot ask user: no broadcast channel available');
            },
            agentId,
            workspacePath,
            allowedSkills,
            agentSkillsDir,
          }).then((result) => mergeDomainToolVisualization(skillPayload, args, result)),
      });
    }
  }

  // ── Memory tool ───────────────────────────────────────────
  const memoryPayload = domainPayload('memory');
  const memorySettings = workspace.settings?.memory;
  if (memoryPayload && memorySettings?.enabled) {
    const permissionRisk = memorySettings.permissionRisk;
    tools['memory'] = tool({
      description: memoryPayload.description,
      inputSchema: jsonSchema(memoryPayload.inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'memory', broadcastFn, workspaceId, rootSessionId);
          const result = await memoryPayload.execute(args, {
            workspaceId,
            sessionId,
            ask: (ask: import('@capekai/tool').Ask) => askApi(ask),
            agentId,
            workspacePath,
            permissionRisk,
          });
          return mergeDomainToolVisualization(memoryPayload, args, result);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Workflow tool ─────────────────────────────────────────────
  // Same generic domain seam as session_search and scheduler: the domain
  // payload owns the depth gate (isEnabled) and the dynamic definition
  // (allowed leaf agent list); the workspace settings gate stays here, and
  // the allowed-subagent list is captured at build time from the resolved
  // definition exactly like pre-C5.
  const workflowPayload = domainPayload('workflow');
  const workflowSettings = workspace.settings?.workflow;
  if (workflowPayload && workflowSettings?.enabled && canSpawn && await workflowPayload.isEnabled?.(workspaceId, sessionId) === true) {
    const workflowDefinition = await workflowPayload.resolveDefinition?.(sessionId, {
      canSpawnSubagents,
      allowSelfAsSubagent,
    });
    if (workflowDefinition) {
      tools['workflow'] = tool({
        description: workflowDefinition.description,
        inputSchema: jsonSchema(workflowDefinition.inputSchema),
        execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          const toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
          try {
            const workflowInput = {
              prompt: args.prompt as string,
              ...(args.description ? { description: args.description as string } : {}),
              ...(args.subtasks ? { subtasks: args.subtasks as WorkflowInput['subtasks'] } : {}),
              ...(args.leafPreconfigId ? { leafPreconfigId: args.leafPreconfigId as string } : {}),
              ...(args.outputSchema ? { outputSchema: args.outputSchema as Record<string, unknown> } : {}),
            } as WorkflowInput;

            return await workflowPayload.execute(
              workflowInput as unknown as Record<string, unknown>,
              {
              workspaceId,
              sessionId,
              ask: broadcastFn
                ? (ask: import('@capekai/tool').Ask) =>
                  createAskApi(sessionId, toolCallId, workflowPayload.name, broadcastFn, workspaceId, rootSessionId)(ask)
                : async () => {
                  throw new Error('Cannot ask user: no broadcast channel available');
                },
              agentId,
              workspacePath,
              abortSignal: toolAbortController.signal,
              allowedSubagentIds: workflowDefinition.allowedSubagentIds,
            });
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
          }
        },
      });
    }
  }

  // ── Skill management tool ─────────────────────────────────
  const skillManagePayload = domainPayload('skill_manage');
  const skillSettings = workspace.settings?.skills;
  if (skillManagePayload && skillSettings?.managementEnabled) {
    const permissionRisk = skillSettings.permissionRisk;
    const skillManageDefinition = await skillManagePayload.resolveDefinition?.(sessionId, {
      workspacePath,
    });
    if (skillManageDefinition) {
      tools['skill_manage'] = tool({
        description: skillManageDefinition.description,
        inputSchema: jsonSchema(skillManageDefinition.inputSchema),
        execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
          const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
          try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'skill_manage', broadcastFn, workspaceId, rootSessionId);
          const result = await skillManagePayload.execute(args, {
            workspaceId,
            sessionId,
            ask: (ask: import('@capekai/tool').Ask) => askApi(ask),
            agentId,
            workspacePath,
            permissionRisk,
          });
          return mergeDomainToolVisualization(skillManagePayload, args, result);
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
            await rejectPendingAsksByToolCallId(toolCallId);
          }
        },
      });
    }
  }

  // ── Session search tool ───────────────────────────────────
  // The domain payload owns the settings gate (isEnabled) and the executor;
  // the settings values the executor needs are captured here at build time
  // exactly like pre-C5 and passed through the execution context.
  const sessionSearchPayload = domainPayload('session_search');
  const searchSettings = workspace.settings?.sessionSearch;
  if (sessionSearchPayload && await sessionSearchPayload.isEnabled?.(workspaceId, sessionId) === true) {
    tools['session_search'] = tool({
      description: sessionSearchPayload.description,
      inputSchema: jsonSchema(sessionSearchPayload.inputSchema as Record<string, unknown>),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, sessionSearchPayload.name, broadcastFn, workspaceId, rootSessionId);
          const result = await sessionSearchPayload.execute(
            args,
            {
              workspaceId,
              sessionId,
              ask: (ask: import('@capekai/tool').Ask) => askApi(ask),
              agentId,
              permissionRisk: searchSettings?.permissionRisk,
              includeToolResults: searchSettings?.includeToolResults === true,
            },
          );
          return mergeDomainToolVisualization(sessionSearchPayload, args, result);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Scheduler tool ────────────────────────────────────────
  // Same generic domain seam as session_search: the domain payload owns the
  // workspace settings gate plus the current-session scheduled-job recursion
  // gate (isEnabled) and the executor; the permission risk is captured here
  // at build time exactly like pre-C5 and passed through the execution
  // context.
  const schedulerPayload = domainPayload('scheduler');
  if (schedulerPayload && await schedulerPayload.isEnabled?.(workspaceId, sessionId) === true) {
    const schedulingRisk: PermissionRiskLevel = workspace.settings?.scheduling?.permissionRisk ?? 'none';
    tools['scheduler'] = tool({
      description: schedulerPayload.description,
      inputSchema: jsonSchema(schedulerPayload.inputSchema as Record<string, unknown>),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, schedulerPayload.name, broadcastFn, workspaceId, rootSessionId);
          const result = await schedulerPayload.execute(
            args,
            {
              workspaceId,
              sessionId,
              ask: (ask: import('@capekai/tool').Ask) => askApi(ask),
              agentId,
              permissionRisk: schedulingRisk,
            },
          );
          return mergeDomainToolVisualization(schedulerPayload, args, result);
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          await rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  return tools;
}

// ── Shared helpers ───────────────────────────────────────────

function createAskApiOrThrow(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  broadcastFn: AskBroadcastFn | undefined,
  workspaceId: string | undefined,
  rootSessionId: string,
): import('@capekai/tool').AskApi {
  if (!broadcastFn) {
    throw new Error('Cannot ask user: no broadcast channel available');
  }
  return createAskApi(sessionId, toolCallId, toolName, broadcastFn, workspaceId, rootSessionId);
}
