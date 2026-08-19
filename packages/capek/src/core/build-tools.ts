import {
  emitRuntimeEvent,
  type BroadcastFn,
} from '../runtime/host-dependencies';
import { getAgentDirectory } from '../context';
import { discoverWorkspaceTools } from '../tools/tool-source';
import {
  buildRetrieveToolOutputAiTool,
  RETRIEVE_TOOL_OUTPUT_NAME,
  wrapToolsWithOutputPolicy,
} from '../tool-output/policy';
import { getSession } from '../storage/runtime';
import type { AskBroadcastFn } from '../permission/ask-user-api';
import { hasScopedToolRegistryResolver } from '../tools/registry';
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
  broadcast: BroadcastFn = emitRuntimeEvent,
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
  const rootSessionId = explicitRootSessionId ?? (await (async () => {
    let current = sessionId;
    let session = await getSession(current);
    while (session?.parentId) {
      current = session.parentId;
      session = await getSession(current);
    }
    return current;
  })());

  // Resolve execution scopes for capability filtering (separate from ask-routing root)
  const executionScopes = await resolveToolExecutionScopes(sessionId);

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
      const mcpTools = await discoverWorkspaceTools(workspacePath, sessionId);
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

  // The unscoped legacy Jean2 path keeps the unconditional retrieval
  // injection. Under a scoped contributed resolver, retrieval is an
  // ordinary contributed tool: it enters through toolNames -> resolver ->
  // buildExternalTools exactly when its contribution is visible.
  if (!hasScopedToolRegistryResolver()) {
    tools[RETRIEVE_TOOL_OUTPUT_NAME] = buildRetrieveToolOutputAiTool(sessionId);
  }
  return wrapToolsWithOutputPolicy(tools, { sessionId, workspaceId });
}
