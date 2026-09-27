import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

export interface CodexSessionSearchBridge {
  definitions(): Array<{ type: 'function'; name: string; description: string; inputSchema: unknown }>;
  execute(input: Record<string, unknown>, workspaceId: string, sessionId: string,
    includeToolResults: boolean, risk: PermissionRiskLevel,
    ask: (request: PermissionAsk) => Promise<boolean>, agentId: string | null):
    Promise<{ success: boolean; error?: string }>;
}

const fail = (message: string): CodexMemoryCallResult => ({ success: false,
  contentItems: [{ type: 'inputText', text: message }] });
const MAX_ARGUMENTS = 32_000;
const MAX_RESULT = 64_000;
const RISKS = ['none', 'low', 'medium', 'high', 'critical'];

/** Restrict Codex calls to the configured workspace and the active turn. */
export function createCodexSessionSearchTools(options: {
  bridge: CodexSessionSearchBridge;
  definitions?: ReturnType<CodexSessionSearchBridge['definitions']>;
  workspaceId: string;
  sessionId: string;
  preconfigId: string;
  agentDir: string | null;
  isActive(turnId: string): boolean;
  authorizeRoot(): boolean;
  ask(request: PermissionAsk): Promise<boolean>;
}): { definitions: ReturnType<CodexSessionSearchBridge['definitions']>; call(raw: unknown): Promise<CodexMemoryCallResult> } {
  const definitions = (options.definitions ?? options.bridge.definitions()).filter(definition =>
    definition.type === 'function' && definition.name === 'session_search'
    && getWorkspace(options.workspaceId)?.settings.sessionSearch?.enabled === true);
  const seen = new Set<string>();
  const authorized = (turnId: string): boolean => {
    const session = getSession(options.sessionId);
    return options.isActive(turnId) && options.authorizeRoot() && session?.harness === 'codex-cli'
      && session.workspaceId === options.workspaceId;
  };
  return {
    definitions,
    async call(raw) {
      const params = codexObject(raw);
      if (!definitions.length || !params || typeof params.turnId !== 'string' || !authorized(params.turnId)
        || params.namespace !== null || params.tool !== 'session_search'
        || typeof params.callId !== 'string' || !params.callId || params.callId.length > 256) {
        return fail('Session search unavailable');
      }
      if (seen.has(params.callId)) return fail('Duplicate session search call');
      seen.add(params.callId);
      const input = codexObject(params.arguments);
      if (!input || JSON.stringify(input).length > MAX_ARGUMENTS
        || input.action !== undefined && !['list', 'search', 'read'].includes(String(input.action))
        || input.scope !== undefined && !['current_session', 'workspace', 'agent'].includes(String(input.scope))
        || input.query !== undefined && typeof input.query !== 'string'
        || input.sessionId !== undefined && typeof input.sessionId !== 'string'
        || input.aroundMessageId !== undefined && typeof input.aroundMessageId !== 'string'
        || input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isFinite(input.limit))
        || input.window !== undefined && (typeof input.window !== 'number' || !Number.isFinite(input.window))
        || input.sort !== undefined && !['relevance', 'newest', 'oldest'].includes(String(input.sort))
        || input.roleFilter !== undefined && (!Array.isArray(input.roleFilter)
          || !input.roleFilter.every(role => ['user', 'assistant', 'tool'].includes(role)))) {
        return fail('Invalid session search arguments');
      }
      const settings = getWorkspace(options.workspaceId)?.settings.sessionSearch;
      if (!settings?.enabled || !RISKS.includes(String(settings.permissionRisk))) {
        return fail('Session search is disabled or permission risk is unavailable');
      }
      const risk = settings.permissionRisk as PermissionRiskLevel;
      const agentId = options.agentDir && getSession(options.sessionId)?.agentId === options.preconfigId
        ? options.preconfigId : null;
      if (input.scope === 'agent' && !agentId) return fail('Agent scope requires an agent session');
      try {
        const result = await options.bridge.execute(input, options.workspaceId, options.sessionId,
          settings.includeToolResults === true, risk, async request => {
            if (!authorized(params.turnId as string)) return false;
            const approved = await options.ask(request);
            const current = getWorkspace(options.workspaceId)?.settings.sessionSearch;
            return approved && authorized(params.turnId as string)
              && current?.enabled === true && current.permissionRisk === risk
              && current.includeToolResults === settings.includeToolResults
              && (agentId === null || getSession(options.sessionId)?.agentId === agentId);
          }, agentId);
        const current = getWorkspace(options.workspaceId)?.settings.sessionSearch;
        if (!authorized(params.turnId) || !current?.enabled || current.permissionRisk !== risk
          || current.includeToolResults !== settings.includeToolResults
          || agentId !== null && getSession(options.sessionId)?.agentId !== agentId) {
          return fail('Session search unavailable');
        }
        const text = JSON.stringify(result.success ? result : { error: result.error ?? 'Session search failed' });
        if (text.length > MAX_RESULT) return fail('Session search result exceeds the response limit; narrow the search');
        return { success: result.success, contentItems: [{ type: 'inputText', text }] };
      } catch {
        return fail('Session search failed');
      }
    },
  };
}
