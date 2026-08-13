import {
  broadcastEvent,
  getAgentDirectory,
  getMcpTools,
  getSession,
  type BroadcastFn,
} from '../compat/jean2-dependencies';
import type { AskBroadcastFn } from '../tools/ask-user-api';
import { join } from 'path';
import { buildExternalTools } from './tool-builders/external-tools';
import { buildWorkspaceTools } from './tool-builders/workspace-tools';
import { buildAgentTools } from './tool-builders/agent-tools';
import { resolveToolExecutionScopes } from './tool-capabilities';
import type { ToolMap } from './tool-builders/types';

export interface BuildToolsOptions {
  toolNames: string[];
  workspacePath: string | undefined;
  workspaceId: string | undefined;
  sessionId: string;
  rootSessionId?: string;
  modelId?: string;
  providerId?: string;
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  allowedSkills?: string[] | null;
  broadcastFn?: AskBroadcastFn;
  additionalPaths?: string[];
  agentId?: string | null;
}

export async function buildAiSdkTools(
  options: BuildToolsOptions,
  broadcast: BroadcastFn = broadcastEvent,
): Promise<Record<string, import('ai').Tool>> {
  const {
    toolNames,
    workspacePath,
    workspaceId,
    sessionId,
    rootSessionId: explicitRootSessionId,
    modelId,
    providerId,
    canSpawnSubagents,
    allowSelfAsSubagent,
    allowedSkills,
    broadcastFn,
    additionalPaths,
    agentId,
  } = options;

  // Resolve root session ID by walking up the parent chain
  const rootSessionId = explicitRootSessionId ?? (() => {
    let current = sessionId;
    let session = getSession(current);
    while (session?.parentId) {
      current = session.parentId;
      session = getSession(current);
    }
    return current;
  })();

  // Resolve execution scopes for capability filtering (separate from ask-routing root)
  const executionScopes = resolveToolExecutionScopes(sessionId);

  const canSpawn = canSpawnSubagents === true
    || (Array.isArray(canSpawnSubagents) && canSpawnSubagents.length > 0);
  const allowedSubagentIds = Array.isArray(canSpawnSubagents) ? canSpawnSubagents : undefined;

  // Resolve agent directory for skills
  const agentDir = agentId ? await getAgentDirectory(agentId) : undefined;
  const agentSkillsDir = agentDir ? join(agentDir, 'skills') : undefined;

  // Phase 1: External tools (task subagent + registry tools)
  const externalTools = await buildExternalTools({
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
  });
  const tools: ToolMap = { ...externalTools };

  // Phase 2: Workspace-gated tools (memory, workflow, skills, search, scheduler)
  if (workspaceId && workspacePath) {
    const workspaceTools = await buildWorkspaceTools({
      workspaceId,
      workspacePath,
      rootSessionId,
      sessionId,
      canSpawn,
      canSpawnSubagents,
      allowSelfAsSubagent,
      allowedSubagentIds,
      broadcastFn,
      agentId,
      allowedSkills,
      agentSkillsDir,
    });
    Object.assign(tools, workspaceTools);

    // Phase 3: MCP tools
    try {
      const mcpTools = await getMcpTools(workspacePath, sessionId);
      Object.assign(tools, mcpTools);
    } catch (err) {
      console.error('Failed to load MCP tools:', err);
    }
  }

  // Phase 4: Agent-specific tools (agent_memory, agent_skill_manage)
  if (agentDir) {
    const agentTools = await buildAgentTools({ agentDir });
    Object.assign(tools, agentTools);
  }

  return tools;
}
