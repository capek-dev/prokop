import { isAbsolute, join } from 'node:path';
import { safeSkillDirectory, type AgentSkillsDomainBridge } from '@/adapters/capek/domain-tools';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });
const ACTIONS = ['list', 'create', 'update', 'patch', 'delete'];
const FIELDS = ['name', 'description', 'content', 'oldString', 'newString'];

/** Only the bound agent's skill directory is writable through this tool. */
export function createCodexAgentSkillTools(options: {
  bridge: AgentSkillsDomainBridge;
  definitions?: ReturnType<AgentSkillsDomainBridge['definitions']>;
  sessionId: string;
  workspaceId: string;
  preconfigId: string;
  agentDir: string | null;
  isActive(turnId: string): boolean;
  authorizeRoot(): boolean;
}): { definitions: ReturnType<AgentSkillsDomainBridge['definitions']>;
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
        const skillsDir = join(options.agentDir!, 'skills');
        const result = await options.bridge.execute(input, skillsDir);
        if (!authorized(params.turnId)) return fail('Agent skill management unavailable');
        // The executor returns skill-relative paths; make them absolute so the
        // model never has to guess the on-disk skills location.
        const payload = result.success && typeof result.path === 'string' && result.path
          && !isAbsolute(result.path) ? { ...result, path: join(skillsDir, result.path) } : result;
        const text = JSON.stringify(result.success ? payload
          : { error: result.error ?? 'Agent skill operation failed' });
        if (text.length > 32_000) return fail('Agent skill result exceeds response limit');
        return { success: result.success, contentItems: [{ type: 'inputText', text }] };
      } catch { return fail('Agent skill operation failed'); }
    },
  };
}
