import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';
import type { CodexMemoryBridge } from '../codex-cli/memory-tools';

/** The in-process server name; the SDK reports its tools as mcp__prokop__<name>. */
export const PROKOP_MCP_SERVER = 'prokop';

const MAX_ARGUMENTS = 32_000;
const MAX_RESULT = 16_000;
const RISKS = ['none', 'low', 'medium', 'high', 'critical'];

/** Mirrors the Capek memory input schema; a test pins it to the live definition. */
export const claudeMemoryShape = {
  action: z.enum(['list', 'add', 'replace', 'remove']).describe('The action to perform on the memory file.'),
  target: z.enum(['user', 'memory']).describe('Which memory file to modify. "user" for preferences, "memory" for workspace facts.'),
  content: z.string().optional().describe('The new content for add/replace actions.'),
  oldText: z.string().optional().describe('The text to find for replace/remove actions. Must match exactly one entry.'),
};

const fail = (message: string): { content: Array<{ type: 'text'; text: string }>; isError: boolean } => ({
  content: [{ type: 'text', text: message }], isError: true,
});

/** Register the Prokop memory tools for one Claude turn on the in-process MCP server. */
export function createClaudeMemoryTools(options: {
  bridge: CodexMemoryBridge;
  definitions?: ReturnType<CodexMemoryBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  root: string;
  agentDir: string | null;
  preconfigId: string | null;
  signal: AbortSignal;
  ask(request: PermissionAsk): Promise<boolean>;
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
      const risk = definition.name === 'agent_memory' ? 'none' : workspace.settings.memory?.permissionRisk;
      if (!RISKS.includes(String(risk))) return fail('Workspace memory permission risk is unavailable');
      try {
        const result = await options.bridge.execute(input as Record<string, unknown>,
          definition.name === 'agent_memory' ? options.agentDir! : resolveWorkspaceMemoryDir(options.root),
          risk as PermissionRiskLevel,
          definition.name === 'agent_memory' ? undefined : async request => {
            if (!authorized()) return false;
            const approved = await options.ask(request);
            const latest = getWorkspace(options.workspaceId);
            return approved && authorized() && latest?.settings.memory?.enabled === true
              && latest?.settings.memory?.permissionRisk === risk;
          });
        if (!authorized()) return fail('Memory tool unavailable');
        const text = JSON.stringify(result.success ? result.result : { error: result.error ?? 'Memory operation failed' });
        return { content: [{ type: 'text', text: text.length <= MAX_RESULT ? text : `${text.slice(0, MAX_RESULT)}\n[truncated]` }],
          isError: !result.success };
      } catch { return fail('Memory operation failed'); }
    },
    // The SDK's own tools param uses an open generic; widen through unknown.
    { alwaysLoad: true })) as unknown as SdkMcpToolDefinition[];
}

/** Transcript-friendly names for the Prokop MCP tools the SDK reports. */
export function claudeMcpToolDisplayName(name: string): string | null {
  if (name === `mcp__${PROKOP_MCP_SERVER}__memory`) return 'Claude Memory';
  if (name === `mcp__${PROKOP_MCP_SERVER}__agent_memory`) return 'Claude Agent memory';
  return null;
}
