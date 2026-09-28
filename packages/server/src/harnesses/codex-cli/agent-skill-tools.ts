import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

export interface CodexAgentSkillBridge {
  definitions(): Array<{ type: 'function'; name: string; description: string; inputSchema: unknown }>;
  execute(input: Record<string, unknown>, directory: string): Promise<{
    success: boolean; error?: string; title?: string; action?: string; name?: string;
    description?: string; path?: string; summary?: string;
    skills?: Array<{ name: string; description: string }>;
  }>;
}

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });
const ACTIONS = ['list', 'create', 'update', 'patch', 'delete'];
const FIELDS = ['name', 'description', 'content', 'oldString', 'newString'];

// The core manager follows SKILL.md symlinks on update/patch. Reject unsafe trees
// before delegating so this bridge cannot write through an existing link.
async function safeSkillDirectory(agentDir: string): Promise<boolean> {
  if (!isAbsolute(agentDir)) return false;
  try {
    if (!(await lstat(agentDir)).isDirectory()) return false;
    const root = join(agentDir, 'skills');
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
    if (!(await lstat(root)).isDirectory()) return false;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return false;
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, 'SKILL.md');
      try { if (!(await lstat(path)).isFile()) return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
    }
    return true;
  } catch { return false; }
}

/** Only the bound agent's skill directory is writable through this tool. */
export function createCodexAgentSkillTools(options: {
  bridge: CodexAgentSkillBridge;
  definitions?: ReturnType<CodexAgentSkillBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  preconfigId: string;
  agentDir: string | null;
  isActive(turnId: string): boolean;
  authorizeRoot(): boolean;
}): { definitions: ReturnType<CodexAgentSkillBridge['definitions']>;
  call(raw: unknown): Promise<CodexMemoryCallResult> } {
  const definitions = options.agentDir
    ? (options.definitions ?? options.bridge.definitions()).filter(definition =>
      definition.type === 'function' && definition.name === 'agent_skill_manage') : [];
  const seen = new Set<string>();
  const authorized = (turnId: string): boolean => {
    const session = getSession(options.sessionId);
    return !!options.agentDir && isAbsolute(options.agentDir) && options.isActive(turnId) && options.authorizeRoot()
      && session?.harness === 'codex-cli' && session.workspaceId === options.workspaceId
      && session.preconfigId === options.preconfigId && session.agentId === options.preconfigId;
  };
  return {
    definitions,
    async call(raw) {
      const params = codexObject(raw);
      if (!definitions.length || !params || typeof params.turnId !== 'string' || !authorized(params.turnId)
        || params.namespace !== null || params.tool !== 'agent_skill_manage'
        || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) {
        return fail('Agent skill management unavailable');
      }
      if (seen.has(params.callId)) return fail('Duplicate agent skill call');
      seen.add(params.callId);
      const input = codexObject(params.arguments);
      if (!input || JSON.stringify(input).length > 32_000 || !ACTIONS.includes(String(input.action))
        || FIELDS.some(field => input[field] !== undefined && typeof input[field] !== 'string')
        || input.action !== 'list' && (typeof input.name !== 'string' || !input.name)) {
        return fail('Invalid agent skill arguments');
      }
      try {
        if (!await safeSkillDirectory(options.agentDir!) || !authorized(params.turnId)) {
          return fail('Agent skill directory unavailable');
        }
        const result = await options.bridge.execute(input, join(options.agentDir!, 'skills'));
        if (!authorized(params.turnId)) return fail('Agent skill management unavailable');
        const text = JSON.stringify(result.success ? result : { error: result.error ?? 'Agent skill operation failed' });
        if (text.length > 32_000) return fail('Agent skill result exceeds response limit');
        return { success: result.success, contentItems: [{ type: 'inputText', text }] };
      } catch { return fail('Agent skill operation failed'); }
    },
  };
}
