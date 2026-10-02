import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isAbsolute, join } from 'node:path';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';
import { safeSkillDirectory,
  type AgentSkillsDomainBridge, type MemoryDomainBridge, type SessionSearchDomainBridge } from '@/adapters/capek/domain-tools';

/** The in-process server name; re-exported from the shared harness module. */
export { PROKOP_MCP_SERVER } from '@/harnesses/shared/tool-viz';

const MAX_ARGUMENTS = 32_000;
const MAX_RESULT = 16_000;
const MAX_RESULT_SEARCH = 64_000;

/** Mirrors the Capek memory input schema; a test pins it to the live definition. */
export const claudeMemoryShape = {
  action: z.enum(['list', 'add', 'replace', 'remove']).describe('The action to perform on the memory file.'),
  target: z.enum(['user', 'memory']).describe('Which memory file to modify. "user" for preferences, "memory" for workspace facts.'),
  content: z.string().optional().describe('The new content for add/replace actions.'),
  oldText: z.string().optional().describe('The text to find for replace/remove actions. Must match exactly one entry.'),
};

/** Mirrors the Capek session search input schema; a test pins it to the live definition. */
export const claudeSessionSearchShape = {
  action: z.enum(['list', 'search', 'read']).optional().describe('The action to perform. "list": enumerate recent sessions. "search": full-text search (default if query provided). "read": read session context. Defaults to "search" if query is provided, "read" if sessionId is provided.'),
  query: z.string().optional().describe('Search query for full-text search. Triggers search mode.'),
  scope: z.enum(['current_session', 'workspace', 'agent']).optional().describe('Search scope. "current_session" searches only the current session archive. "workspace" searches all sessions in the workspace. "agent" searches YOUR past sessions across ALL workspaces. Defaults to "workspace".'),
  sessionId: z.string().optional().describe('Session ID for read-around mode. Use "list" action first to discover session IDs. Must belong to the current workspace or (for agents) be an agent-owned session.'),
  aroundMessageId: z.string().optional().describe('Anchor message ID for read-around mode. Returns surrounding messages. If omitted, reads the latest messages in the session.'),
  limit: z.number().optional().describe('Max results for search mode, or max sessions for list mode. Default 5, max 20.'),
  window: z.number().optional().describe('Number of messages to return around the anchor in read-around mode. Default 8, max 25.'),
  roleFilter: z.array(z.enum(['user', 'assistant', 'tool'])).optional().describe('Roles to include in results. Defaults to ["user", "assistant"] unless workspace includes tool results.'),
  sort: z.enum(['relevance', 'newest', 'oldest']).optional().describe('Sort order for search results. Defaults to "relevance".'),
};

/** Mirrors the Capek skill manage input schema; a test pins it to the live definition. */
export const claudeSkillManageShape = {
  action: z.enum(['list', 'create', 'update', 'patch', 'delete']).describe('The action to perform.'),
  name: z.string().optional().describe('Skill name (will be normalized to a safe slug). Matched case-insensitively against existing skills.'),
  description: z.string().optional().describe('Concise trigger/use description for the skill. Required for create. Optional for update/patch.'),
  content: z.string().optional().describe('Markdown body for create/update actions. Not full frontmatter — just the body.'),
  oldString: z.string().optional().describe('Exact text to find for patch action. Must match exactly once. Load the skill first to see the exact content.'),
  newString: z.string().optional().describe('Replacement text for patch action.'),
};

const fail = (message: string): { content: Array<{ type: 'text'; text: string }>; isError: boolean } => ({
  content: [{ type: 'text', text: message }], isError: true,
});

/** Register the Prokop memory tools for one Claude turn on the in-process MCP server. */
export function createClaudeMemoryTools(options: {
  bridge: MemoryDomainBridge;
  definitions?: ReturnType<MemoryDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  root: string;
  agentDir: string | null;
  preconfigId: string | null;
  signal: AbortSignal;
}): SdkMcpToolDefinition[] {
  // A per-turn allowlist built from the workspace setting and the selected agent home.
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition =>
    definition.type === 'function' && (definition.name === 'memory' || definition.name === 'agent_memory')
    && (definition.name !== 'agent_memory' || options.agentDir !== null)
    && (definition.name !== 'memory' || getWorkspace(options.workspaceId)?.settings.memory?.enabled === true));
  // The turn, its preconfig, and its workspace must still own the call when it runs.
  const authorized = (): boolean => {
    if (options.signal.aborted) return false;
    try {
      const current = getSession(options.sessionId);
      return !!current && current.harness === 'claude-cli' && current.status === 'active'
        && current.workspaceId === options.workspaceId && current.preconfigId === options.preconfigId;
    } catch { return false; }
  };
  // Widen the specific zod shape to the SDK's open tool type; the definitions
  // all share claudeMemoryShape and the generic is invariant through the handler.
  return definitions.map(definition => tool(definition.name, definition.description, claudeMemoryShape,
    async input => {
      if (!authorized()) return fail('Memory tool unavailable');
      if (JSON.stringify(input).length > MAX_ARGUMENTS) return fail('Invalid memory arguments');
      const workspace = getWorkspace(options.workspaceId);
      if (!workspace || definition.name === 'memory' && workspace.settings.memory?.enabled !== true) {
        return fail('Workspace memory is disabled');
      }
      try {
        // Capability tools are always allowed when enabled; no per-write ask.
        const result = await options.bridge.execute(input as Record<string, unknown>,
          definition.name === 'agent_memory' ? options.agentDir! : resolveWorkspaceMemoryDir(options.root),
          'none');
        if (!authorized()) return fail('Memory tool unavailable');
        const text = JSON.stringify(result.success ? result.result : { error: result.error ?? 'Memory operation failed' });
        return { content: [{ type: 'text', text: text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }],
          isError: !result.success };
      } catch { return fail('Memory operation failed'); }
    },
    // The SDK's own tools param uses an open generic; widen through unknown.
    { alwaysLoad: true })) as unknown as SdkMcpToolDefinition[];
}

/** Register the Prokop session search tool for one Claude turn on the in-process MCP server. */
export function createClaudeSessionSearchTools(options: {
  bridge: SessionSearchDomainBridge;
  definitions?: ReturnType<SessionSearchDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  preconfigId: string | null;
  agentDir: string | null;
  signal: AbortSignal;
}): SdkMcpToolDefinition[] {
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition =>
    definition.type === 'function' && definition.name === 'session_search'
    && getWorkspace(options.workspaceId)?.settings.sessionSearch?.enabled === true);
  const authorized = (): boolean => {
    if (options.signal.aborted) return false;
    try {
      const current = getSession(options.sessionId);
      return !!current && current.harness === 'claude-cli' && current.status === 'active'
        && current.workspaceId === options.workspaceId && current.preconfigId === options.preconfigId;
    } catch { return false; }
  };
  return definitions.map(definition => tool(definition.name, definition.description, claudeSessionSearchShape,
    async input => {
      if (!authorized()) return fail('Session search unavailable');
      if (JSON.stringify(input).length > MAX_ARGUMENTS
        || input.limit !== undefined && !Number.isFinite(input.limit)
        || input.window !== undefined && !Number.isFinite(input.window)) {
        return fail('Invalid session search arguments');
      }
      const settings = getWorkspace(options.workspaceId)?.settings.sessionSearch;
      if (!settings?.enabled) {
        return fail('Session search is disabled');
      }
      // Agent scope reads the selected agent's cross-workspace sessions, exactly like Codex.
      const agentId = options.agentDir && getSession(options.sessionId)?.agentId === options.preconfigId
        ? options.preconfigId : null;
      if (input.scope === 'agent' && !agentId) return fail('Agent scope requires an agent session');
      try {
        // Capability tools are always allowed when enabled; no per-write ask.
        const result = await options.bridge.execute(input as Record<string, unknown>, options.workspaceId,
          options.sessionId, settings.includeToolResults === true,
          'none', undefined, agentId);
        const current = getWorkspace(options.workspaceId)?.settings.sessionSearch;
        if (!authorized() || !current?.enabled
          || current.includeToolResults !== settings.includeToolResults
          || agentId !== null && getSession(options.sessionId)?.agentId !== agentId) {
          return fail('Session search unavailable');
        }
        const text = JSON.stringify(result.success ? result : { error: result.error ?? 'Session search failed' });
        if (text.length > MAX_RESULT_SEARCH) {
          return fail('Session search result exceeds the response limit; narrow the search');
        }
        return { content: [{ type: 'text', text }], isError: !result.success };
      } catch { return fail('Session search failed'); }
    },
    { alwaysLoad: true })) as unknown as SdkMcpToolDefinition[];
}

/** Register the agent skill manager for one Claude turn; writes stay in the selected agent home. */
export function createClaudeSkillManageTools(options: {
  bridge: AgentSkillsDomainBridge;
  definitions?: ReturnType<AgentSkillsDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  preconfigId: string | null;
  agentDir: string | null;
  signal: AbortSignal;
}): SdkMcpToolDefinition[] {
  const definitions = options.agentDir
    ? (options.definitions ?? options.bridge.definitions()).filter(definition =>
      definition.type === 'function' && definition.name === 'agent_skill_manage') : [];
  // The turn, its preconfig, and the bound agent home must still own the call when it runs.
  const authorized = (): boolean => {
    if (options.signal.aborted) return false;
    try {
      const current = getSession(options.sessionId);
      return !!options.agentDir && !!current && current.harness === 'claude-cli'
        && current.status === 'active' && current.workspaceId === options.workspaceId
        && current.preconfigId === options.preconfigId && current.agentId === options.preconfigId;
    } catch { return false; }
  };
  // Widen the specific zod shape to the SDK's open tool type, as with the memory tools.
  return definitions.map(definition => tool(definition.name, definition.description, claudeSkillManageShape,
    async input => {
      if (!authorized()) return fail('Agent skill management unavailable');
      if (JSON.stringify(input).length > MAX_ARGUMENTS
        || input.action !== 'list' && (typeof input.name !== 'string' || !input.name)) {
        return fail('Invalid agent skill arguments');
      }
      try {
        if (!await safeSkillDirectory(options.agentDir!) || !authorized()) {
          return fail('Agent skill directory unavailable');
        }
        const skillsDir = join(options.agentDir!, 'skills');
        const result = await options.bridge.execute(input as Record<string, unknown>, skillsDir);
        if (!authorized()) return fail('Agent skill management unavailable');
        // The executor returns skill-relative paths; make them absolute so the
        // model never has to guess the on-disk skills location.
        const payload = result.success && typeof result.path === 'string' && result.path
          && !isAbsolute(result.path) ? { ...result, path: join(skillsDir, result.path) } : result;
        const text = JSON.stringify(result.success ? payload
          : { error: result.error ?? 'Agent skill operation failed' });
        if (text.length > MAX_RESULT) return fail('Agent skill result exceeds response limit');
        return { content: [{ type: 'text', text }], isError: !result.success };
      } catch { return fail('Agent skill operation failed'); }
    },
    { alwaysLoad: true })) as unknown as SdkMcpToolDefinition[];
}
