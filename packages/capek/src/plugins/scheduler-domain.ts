import type { PermissionRiskLevel } from '@capekai/tool'
import type { Session, WorkspaceSchedulingSettings } from '@capekai/types';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolExecuteContext,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import type { SchedulerHost } from '../scheduler/host';
import {
  executeSchedulerTool,
  executeSchedulerToolWithHost,
  schedulerToolDefinition,
  type SchedulerToolResult,
} from '../scheduler/scheduler-tool';
import type { StorageBundle } from '../storage/contracts';
import { getSession, getWorkspace } from '../storage/runtime';
import { capekSchedulerHostKey, capekStorageKey } from './service-keys';

/**
 * C5 scheduler domain plugin. Owns the domain service (agent scope) and the
 * `scheduler` tool contribution. Composed payloads execute through the
 * scope-captured host; the unscoped fallback keeps the pre-C5 execute-time
 * module host. No scheduler context contribution exists today.
 */

export const CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID = 'current.scheduler-domain';
export const SCHEDULER_TOOL_CONTRIBUTION_ID = 'scheduler.scheduler';
/** After the session-search domain contribution (700) so the effective
 * contributed tool order keeps `scheduler` after `session_search`. */
export const SCHEDULER_TOOL_CONTRIBUTION_ORDER = 750;

export interface SchedulerDomainService {
  readonly tools: readonly DomainToolPayload[];
  /** Single availability predicate: workspace settings gate plus the
   * current-session scheduled-job recursion gate, shared by the tool
   * payload. */
  isEnabled(workspaceId: string, sessionId?: string): boolean | Promise<boolean>;
}

export const capekSchedulerDomainKey = serviceKey<SchedulerDomainService>(
  'capek.scheduler-domain',
  'agent',
);

/** Pre-C5 gate body shared by the composed and the unscoped path: the
 * workspace must enable scheduling and the current session's
 * `metadata.scheduledJobId` must be falsy (Boolean coercion, no ancestry
 * walk). Any ancestry or typed-string semantics are a C6 decision. */
function schedulingGate(
  settings: WorkspaceSchedulingSettings | undefined,
  session: Session | null | undefined,
): boolean {
  if (settings?.enabled !== true) return false;
  return !session?.metadata?.scheduledJobId;
}

interface SchedulerPayloadDeps {
  readonly isEnabled: (workspaceId: string, sessionId?: string) => boolean | Promise<boolean>;
  readonly run: (
    input: Record<string, unknown>,
    context: DomainToolExecuteContext,
    risk: PermissionRiskLevel,
  ) => Promise<SchedulerToolResult>;
}

function shapeSchedulerResult(result: SchedulerToolResult): Record<string, unknown> {
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
}

function schedulerPayload(deps: SchedulerPayloadDeps): DomainToolPayload {
  return {
    name: schedulerToolDefinition.name,
    description: schedulerToolDefinition.description,
    inputSchema: schedulerToolDefinition.inputSchema as Readonly<Record<string, unknown>>,
    display: { summary: '{action} {name}' },
    isEnabled: deps.isEnabled,
    visualize: (_input, result) => {
      const jobs = Array.isArray(result.jobs) ? result.jobs.length : undefined;
      if (jobs !== undefined) {
        return {
          type: 'none',
          badge: `${jobs} job${jobs === 1 ? '' : 's'}`,
          message: String(result.title ?? ''),
        };
      }
      return {
        type: 'none',
        message: String(result.title ?? 'Scheduler action completed'),
      };
    },
    execute: async (input, context) => {
      // workspace-tools captures the settings at build time exactly like
      // pre-C5 and passes the value through the execution context; the
      // payload never re-reads workspace settings at execution time.
      const risk = context.permissionRisk as PermissionRiskLevel;
      const result = await deps.run(input, context, risk);
      return shapeSchedulerResult(result);
    },
  };
}

/** Unscoped compatibility payload: keeps the pre-C5 execute-time module host
 * and storage reads. Installed through `installSchedulerToolFallback`, never
 * at module load. */
export function createSchedulerToolFallbackPayload(): DomainToolPayload {
  return schedulerPayload({
    isEnabled: async (workspaceId, sessionId) => schedulingGate(
      (await getWorkspace(workspaceId))?.settings?.scheduling,
      typeof sessionId === 'string' ? await getSession(sessionId) : null,
    ),
    run: (input, context, risk) => executeSchedulerTool(
      input,
      context.workspaceId,
      context.sessionId,
      risk,
      context.ask,
    ),
  });
}

/** Explicitly installs the unscoped legacy fallback. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installSchedulerToolFallback(): void {
  registerDomainToolFallback(
    schedulerToolDefinition.name,
    createSchedulerToolFallbackPayload(),
  );
}

export function schedulerDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSchedulerDomainKey],
    requires: [capekStorageKey, capekSchedulerHostKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const host: SchedulerHost = context.require(capekSchedulerHostKey);
      const isEnabled = async (workspaceId: string, sessionId?: string): Promise<boolean> =>
        schedulingGate(
          (await storage.workspaces.get(workspaceId))?.settings?.scheduling,
          typeof sessionId === 'string' ? await storage.conversation.getSession(sessionId) : null,
        );
      const payload = schedulerPayload({
        isEnabled,
        run: (input, executionContext, risk) => executeSchedulerToolWithHost(
          host,
          input,
          executionContext.workspaceId,
          executionContext.sessionId,
          risk,
          executionContext.ask,
        ),
      });
      const service: SchedulerDomainService = {
        tools: [payload],
        isEnabled,
      };

      context.provide(capekSchedulerDomainKey, service);
      context.contributeTool({
        id: SCHEDULER_TOOL_CONTRIBUTION_ID,
        order: SCHEDULER_TOOL_CONTRIBUTION_ORDER,
        definition: {
          name: payload.name,
          description: payload.description,
          inputSchema: payload.inputSchema,
          timeout: schedulerToolDefinition.timeout,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: payload,
        } as KernelToolDefinition,
        requiredCapabilities: [capekSchedulerDomainKey],
      });
    },
  };
}
