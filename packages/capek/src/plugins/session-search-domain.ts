import type { PermissionRiskLevel } from '@capekai/tool';
import {
  validateContextAssemblyData,
  type ContextAssemblyData,
} from '../context/assembler';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  ContextSectionContribution,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolExecuteContext,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import { getHostGuidance } from '../runtime/host-guidance';
import type { SessionSearchHost } from '../session-search/host';
import {
  executeSessionSearchTool,
  executeSessionSearchToolWithHost,
  sessionSearchToolDefinition,
  type SessionSearchResult,
} from '../session-search/session-search-tool';
import type { StorageBundle } from '../storage/contracts';
import { getWorkspace } from '../storage/runtime';
import { capekSessionSearchHostKey, capekStorageKey } from './service-keys';

/**
 * C5 session-search domain plugin. Owns the domain service (agent scope),
 * the `session_search` tool contribution, and the `session-search-guidance`
 * section. The composed payload executes through the process-scoped host
 * service and the scope storage captured at setup; one `isEnabled`
 * predicate gates both the tool and the guidance.
 */

export const CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID = 'current.session-search-domain';
export const SESSION_SEARCH_TOOL_CONTRIBUTION_ID = 'session-search.session_search';
export const SESSION_SEARCH_TOOL_CONTRIBUTION_ORDER = 700;
export const SESSION_SEARCH_GUIDANCE_SECTION_ID = 'session-search-guidance';

export interface SessionSearchDomainService {
  readonly tools: readonly DomainToolPayload[];
  /** Single availability predicate for the workspace settings gate,
   * shared by the tool gate and the guidance section. */
  isEnabled(workspaceId: string): boolean | Promise<boolean>;
  readonly guidance: string;
}

export const capekSessionSearchDomainKey = serviceKey<SessionSearchDomainService>(
  'capek.session-search-domain',
  'agent',
);

interface SessionSearchPayloadDeps {
  readonly isEnabled: (workspaceId: string) => boolean | Promise<boolean>;
  readonly run: (
    input: Record<string, unknown>,
    context: DomainToolExecuteContext,
    includeToolResults: boolean,
    risk: PermissionRiskLevel,
    agentId: string | null,
  ) => Promise<SessionSearchResult>;
}

function shapeSessionSearchResult(result: SessionSearchResult): Record<string, unknown> {
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
}

function sessionSearchPayload(deps: SessionSearchPayloadDeps): DomainToolPayload {
  return {
    name: sessionSearchToolDefinition.name,
    description: sessionSearchToolDefinition.description,
    inputSchema: sessionSearchToolDefinition.inputSchema as Readonly<Record<string, unknown>>,
    display: { summary: '{action} {query}' },
    isEnabled: deps.isEnabled,
    visualize: (_input, result) => {
      const results = Array.isArray(result.results) ? result.results : undefined;
      if (results) {
        return {
          type: 'file-list',
          badge: `${results.length} result${results.length === 1 ? '' : 's'}`,
          singularLabel: 'result',
          pluralLabel: 'results',
          title: String(result.query ?? String(result.title ?? 'Search')),
          files: results.slice(0, 20).map((r) => ({
            path: String((r as { sessionTitle?: string }).sessionTitle ?? (r as { sessionId?: string }).sessionId ?? ''),
          })),
          total: results.length,
        };
      }
      const sessions = Array.isArray(result.sessions) ? result.sessions : undefined;
      if (sessions) {
        return {
          type: 'file-list',
          badge: `${sessions.length} session${sessions.length === 1 ? '' : 's'}`,
          singularLabel: 'session',
          pluralLabel: 'sessions',
          files: sessions.slice(0, 20).map((s) => ({
            path: String((s as { title?: string }).title ?? (s as { id?: string }).id ?? ''),
          })),
          total: sessions.length,
        };
      }
      const messages = Array.isArray(result.messages) ? result.messages : undefined;
      if (messages) {
        return {
          type: 'none',
          badge: `${messages.length} message${messages.length === 1 ? '' : 's'}`,
          message: String(result.sessionTitle ?? 'Session context'),
        };
      }
      return { type: 'none', message: String(result.title ?? 'Session search completed') };
    },
    execute: async (input, context) => {
      // workspace-tools captures permissionRisk and includeToolResults at
      // build time exactly like pre-C5 and passes them through the execution
      // context; the payload never re-reads workspace settings at execution
      // time.
      const includeToolResults = context.includeToolResults === true;
      const risk = context.permissionRisk as PermissionRiskLevel;
      const agentId = typeof context.agentId === 'string' ? context.agentId : null;
      const result = await deps.run(input, context, includeToolResults, risk, agentId);
      return shapeSessionSearchResult(result);
    },
  };
}

/** Unscoped compatibility payload: keeps the pre-C5 execute-time module host
 * and storage reads. Installed through `installSessionSearchToolFallback`,
 * never at module load. */
export function createSessionSearchToolFallbackPayload(): DomainToolPayload {
  return sessionSearchPayload({
    isEnabled: async (workspaceId) => Boolean(
      (await getWorkspace(workspaceId))?.settings?.sessionSearch?.enabled,
    ),
    run: (input, context, includeToolResults, risk, agentId) => executeSessionSearchTool(
      input,
      context.workspaceId,
      context.sessionId,
      includeToolResults,
      risk,
      context.ask,
      agentId,
    ),
  });
}

/** Explicitly installs the unscoped legacy fallback. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installSessionSearchToolFallback(): void {
  registerDomainToolFallback(
    sessionSearchToolDefinition.name,
    createSessionSearchToolFallbackPayload(),
  );
}

type GuidanceSectionContribution = ContextSectionContribution<ContextAssemblyData>;

export function sessionSearchDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSessionSearchDomainKey],
    requires: [capekStorageKey, capekSessionSearchHostKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const host: SessionSearchHost = context.require(capekSessionSearchHostKey);
      const isEnabled = async (workspaceId: string): Promise<boolean> => Boolean(
        (await storage.workspaces.get(workspaceId))?.settings?.sessionSearch?.enabled,
      );
      const payload = sessionSearchPayload({
        isEnabled,
        run: (input, executionContext, includeToolResults, risk, agentId) =>
          executeSessionSearchToolWithHost(
            host,
            input,
            executionContext.workspaceId,
            executionContext.sessionId,
            includeToolResults,
            risk,
            executionContext.ask,
            agentId,
          ),
      });
      const service: SessionSearchDomainService = {
        tools: [payload],
        isEnabled,
        guidance: getHostGuidance().sessionSearch,
      };

      const guidance: GuidanceSectionContribution = {
        id: SESSION_SEARCH_GUIDANCE_SECTION_ID,
        phase: 'workspace',
        order: 50,
        provide: async (build) => {
          const data = validateContextAssemblyData(build.data);
          if (!data.workspaceId) return null;
          return await isEnabled(data.workspaceId) ? service.guidance : null;
        },
      };

      context.provide(capekSessionSearchDomainKey, service);
      context.contributeTool({
        id: SESSION_SEARCH_TOOL_CONTRIBUTION_ID,
        order: SESSION_SEARCH_TOOL_CONTRIBUTION_ORDER,
        definition: {
          name: payload.name,
          description: payload.description,
          inputSchema: payload.inputSchema,
          timeout: sessionSearchToolDefinition.timeout,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: payload,
        } as KernelToolDefinition,
        requiredCapabilities: [capekSessionSearchDomainKey],
      });
      context.contributeContext(guidance);
    },
  };
}
