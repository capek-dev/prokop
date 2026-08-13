import { tool, jsonSchema } from 'ai';
import {
  buildSkillManageToolDescription,
  createSkillTool,
  executeMemoryTool,
  executeSchedulerTool,
  executeSessionSearchTool,
  executeSkillManageTool,
  getSchedulerToolDefinition,
  getSessionSearchToolDefinition,
  getSkillManageToolDefinition,
  memoryToolDefinition,
} from '../../compat/jean2-dependencies';
import { getWorkspace } from '../../storage/runtime';
import {
  createAskApi,
  rejectPendingAsksByToolCallId,
  type AskBroadcastFn,
} from '../../tools/ask-user-api';
import { interruptManager } from '../interrupt';
import { executeWorkflow, getWorkflowToolDefinition } from '../workflow';
import type { WorkflowInput, WorkflowResult, PermissionRiskLevel } from '@jean2/sdk';
import { join } from 'path';
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
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return tools;

  // ── Skill tool ────────────────────────────────────────────
  if (workspacePath) {
    const skillTool = await createSkillTool(workspacePath, allowedSkills, sessionId, agentSkillsDir);
    if (skillTool) {
      tools[skillTool.name] = skillTool.tool;
    }
  }

  // ── Memory tool ───────────────────────────────────────────
  const memorySettings = workspace.settings?.memory;
  if (memorySettings?.enabled) {
    const permissionRisk = memorySettings.permissionRisk;
    tools['memory'] = tool({
      description: memoryToolDefinition().description,
      inputSchema: jsonSchema(memoryToolDefinition().inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'memory', broadcastFn, workspaceId, rootSessionId);
          const result = await executeMemoryTool(
            args,
            join(workspacePath!, '.jean2'),
            permissionRisk,
            async (ask: import('@jean2/sdk').Ask) => askApi(ask),
          );

          if (!result.success) {
            return { error: result.error ?? 'Memory operation failed', ...(result.entries ? { entries: result.entries } : {}), ...(result.usage ? { usage: result.usage } : {}) };
          }

          const r = result.result!;
          return {
            title: r.action === 'list' ? `Memory list (${r.target})` : 'Memory updated',
            ...r,
          };
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Workflow tool ─────────────────────────────────────────
  const workflowSettings = workspace.settings?.workflow;
  if (workflowSettings?.enabled && canSpawn) {
    const workflowDefinition = await getWorkflowToolDefinition({
      sessionId,
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

            const result = await executeWorkflow(workflowInput, {
              sessionId,
              workspaceId,
              workspacePath,
              abortSignal: toolAbortController.signal,
              allowedSubagentIds: workflowDefinition.allowedSubagentIds,
            });

            return result as WorkflowResult;
          } finally {
            interruptManager.unregisterToolExecution(sessionId, toolCallId);
          }
        },
      });
    }
  }

  // ── Skill management tool ─────────────────────────────────
  const skillSettings = workspace.settings?.skills;
  if (skillSettings?.managementEnabled) {
    const permissionRisk = skillSettings.permissionRisk;
    const skillManageDescription = await buildSkillManageToolDescription(join(workspacePath!, '.agents', 'skills'));
    tools['skill_manage'] = tool({
      description: skillManageDescription,
      inputSchema: jsonSchema(getSkillManageToolDefinition().inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'skill_manage', broadcastFn, workspaceId, rootSessionId);
          const result = await executeSkillManageTool(
            args,
            join(workspacePath!, '.agents', 'skills'),
            permissionRisk,
            async (ask: import('@jean2/sdk').Ask) => askApi(ask),
          );

          if (!result.success) {
            return { error: result.error ?? 'Skill management operation failed' };
          }

          return {
            title: result.title,
            action: result.action,
            name: result.name,
            description: result.description,
            path: result.path,
            summary: result.summary,
            skills: result.skills,
          };
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Session search tool ───────────────────────────────────
  const sessionSearchSettings = workspace.settings?.sessionSearch;
  if (sessionSearchSettings?.enabled) {
    const searchPermissionRisk = sessionSearchSettings.permissionRisk;
    const includeToolResults = sessionSearchSettings.includeToolResults;
    tools['session_search'] = tool({
      description: getSessionSearchToolDefinition().description,
      inputSchema: jsonSchema(getSessionSearchToolDefinition().inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'session_search', broadcastFn, workspaceId, rootSessionId);
          const result = await executeSessionSearchTool(
            args,
            workspaceId,
            sessionId,
            includeToolResults,
            searchPermissionRisk,
            async (ask: import('@jean2/sdk').Ask) => askApi(ask),
            agentId,
          );

          if (!result.success) {
            return { error: result.error ?? 'Session search failed' };
          }

          return {
            success: result.success,
            mode: result.mode,
            title: result.title,
            ...(result.sessions !== undefined && { sessions: result.sessions }),
            ...(result.query !== undefined && { query: result.query }),
            ...(result.scope !== undefined && { scope: result.scope }),
            ...(result.results !== undefined && { results: result.results }),
            ...(result.sessionId !== undefined && { sessionId: result.sessionId }),
            ...(result.sessionTitle !== undefined && { sessionTitle: result.sessionTitle }),
            ...(result.anchorMessageId !== undefined && { anchorMessageId: result.anchorMessageId }),
            ...(result.anchorInferred !== undefined && { anchorInferred: result.anchorInferred }),
            ...(result.messagesBefore !== undefined && { messagesBefore: result.messagesBefore }),
            ...(result.messagesAfter !== undefined && { messagesAfter: result.messagesAfter }),
            ...(result.messages !== undefined && { messages: result.messages }),
          };
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          rejectPendingAsksByToolCallId(toolCallId);
        }
      },
    });
  }

  // ── Scheduler tool ────────────────────────────────────────
  const schedulingSettings = workspace.settings?.scheduling;
  if (schedulingSettings?.enabled) {
    const schedulingRisk: PermissionRiskLevel = schedulingSettings.permissionRisk ?? 'none';
    tools['scheduler'] = tool({
      description: getSchedulerToolDefinition().description,
      inputSchema: jsonSchema(getSchedulerToolDefinition().inputSchema),
      execute: async (args: Record<string, unknown>, { toolCallId }: { toolCallId: string }) => {
        const _toolAbortController = interruptManager.registerToolExecution(sessionId, toolCallId);
        let result;
        try {
          const askApi = createAskApiOrThrow(sessionId, toolCallId, 'scheduler', broadcastFn, workspaceId, rootSessionId);
          result = await executeSchedulerTool(
            args,
            workspaceId,
            sessionId,
            schedulingRisk,
            async (ask: import('@jean2/sdk').Ask) => askApi(ask),
          );
        } finally {
          interruptManager.unregisterToolExecution(sessionId, toolCallId);
          rejectPendingAsksByToolCallId(toolCallId);
        }

        if (!result.success) {
          return { error: result.error ?? 'Scheduler operation failed' };
        }

        return {
          action: result.action,
          title: result.title,
          ...(result.job && { job: result.job }),
          ...(result.jobs && { jobs: result.jobs }),
          ...(result.jobId && { jobId: result.jobId }),
        };
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
): import('@jean2/sdk').AskApi {
  if (!broadcastFn) {
    throw new Error('Cannot ask user: no broadcast channel available');
  }
  return createAskApi(sessionId, toolCallId, toolName, broadcastFn, workspaceId, rootSessionId);
}
