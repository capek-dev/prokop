/**
 * C6 permission policy: REPLACEABLE advice and configuration only.
 *
 * The non-replaceable lifecycle (waiters, routing, validation enforcement,
 * raw-audit denial, canonical grant construction and persistence) lives in
 * `permission/runtime.ts`. This module owns:
 *
 * - The frozen provider options (generic ask timeout constant and the
 *   composition-translated permission timeout).
 * - Authority resolution and value extraction for generic asks.
 * - The module-level validators and canonical grant builder that BOTH the
 *   default provider and the runtime close over. A custom provider can
 *   override the advice methods on its instance, but the runtime never
 *   consults those overrides for mandatory decisions.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Ask } from '@capekai/tool';
import type {
  AskAuthority, AskPermissionResponse, ClientCapability, GrantScope, PermissionIntent,
} from '@capekai/types';
import type { PermissionAsk, PermissionRiskLevel } from '@capekai/tool';
import { SHELL_FILESYSTEM_COMMANDS } from '@capekai/tool';
import { SHELL_DANGEROUS_COMMANDS } from '@capekai/tool';
import { getRuntimeHost } from '../runtime/host';
import type {
  CreateGrantParams,
  PendingAskRecord,
} from '../runtime/host';
import type {
  AskPermissionPolicyOptions,
  AskPermissionPolicyService,
} from './contracts';

export const ASK_TIMEOUT = 5 * 60 * 1000;

/** Legacy export from the pre-C6 permission-request-manager module. */
export const PERMISSION_TIMEOUT = 30 * 60 * 1000;

const DEFAULT_ASK_AUTHORITY: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

const RISK_ORDER: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
const VALID_GRANT_SCOPES: GrantScope[] = ['once', 'session', 'workspace'];

export interface AskPermissionServiceCreateOptions {
  id?: string;
  /** Frozen composition-time options. When omitted (the process-default
   * fallback), the permission timeout resolves live from the installed
   * interaction host exactly like the pre-C6 module code. */
  options?: AskPermissionPolicyOptions;
}

function interaction() {
  return getRuntimeHost().interaction;
}

function resolveOptionsLive(): AskPermissionPolicyOptions {
  return {
    askTimeoutMs: ASK_TIMEOUT,
    permissionTimeoutMs: interaction().getPermissionTimeoutMs(),
  };
}

// ── Module-level non-overridable validators and canonical grants ─────────

export function isRiskAtOrBelow(risk: PermissionRiskLevel, max: PermissionRiskLevel): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(max);
}

export function isValidPermissionResponse(response: unknown): response is AskPermissionResponse {
  if (!response || typeof response !== 'object') return false;
  const record = response as Record<string, unknown>;
  return record.type === 'permission' && VALID_GRANT_SCOPES.includes(record.grant as GrantScope);
}

export function isPermissionApproved(response: unknown): boolean {
  return isValidPermissionResponse(response) && response.grant !== 'deny';
}

export function buildPermissionKey(
  toolName: string,
  resource: string | undefined,
  patterns: string[] | undefined,
): string {
  if (patterns && patterns.length > 0) return patterns[0];
  if (resource) return resource;
  return toolName;
}

export function isDangerousShellIdentity(identity: string | undefined): boolean {
  if (!identity) return false;
  const lower = identity.toLowerCase();
  const dangerous = SHELL_DANGEROUS_COMMANDS.some(
    command => lower === command || lower.startsWith(command + ' '),
  );
  if (dangerous) return true;
  return SHELL_FILESYSTEM_COMMANDS.some(
    command => lower === command || lower.startsWith(command + ' '),
  );
}

/** Canonical grant construction: the only grant-shape source the runtime
 * persists. Enforces allowed scopes, the session-duration default, the
 * root binding, and the dangerous-shell once downgrade. */
export function buildGrantParams(
  record: PendingAskRecord,
  response: AskPermissionResponse,
): CreateGrantParams[] {
  if (!record.workspaceId || response.grant === 'deny') return [];
  const permAsk = record.ask as PermissionAsk;
  let grantScope: GrantScope = response.grant;
  const boundRootSessionId = record.rootSessionId ?? record.sessionId;

  if (permAsk.intents && permAsk.intents.length > 0) {
    const intent: PermissionIntent = permAsk.intents[0];
    if (!intent.allowedScopes.includes(grantScope) || grantScope === 'once') return [];
    const duration = response.duration || (grantScope === 'session' ? 30 * 60 * 1000 : undefined);

    return intent.targets.map((target) => ({
      workspaceId: record.workspaceId!,
      toolName: record.toolName,
      resource: intent.resource,
      action: intent.action,
      permissionKey: target.target,
      grantOptions: {
        scope: grantScope,
        matcher: target.matcher === 'prefix' ? 'prefix' : 'exact',
        patterns: [target.target],
        action: intent.action,
        duration: grantScope === 'session' ? duration : undefined,
        description: permAsk.question,
        boundRootSessionId: grantScope === 'session' ? boundRootSessionId : undefined,
      },
    }));
  }

  const metadata = permAsk.metadata as Record<string, unknown> | undefined;
  const identity = typeof metadata?.baseCommand === 'string' ? metadata.baseCommand : undefined;
  if (permAsk.resource === 'shell-command' && isDangerousShellIdentity(identity)) {
    grantScope = 'once';
  }
  const duration = response.duration || (grantScope === 'session' ? 30 * 60 * 1000 : undefined);
  return [{
    workspaceId: record.workspaceId,
    toolName: record.toolName,
    resource: permAsk.resource ?? 'file',
    action: permAsk.action,
    permissionKey: buildPermissionKey(record.toolName, permAsk.resource ?? 'file', permAsk.patterns),
    grantOptions: {
      scope: grantScope,
      matcher: (permAsk.resource ?? 'file') === 'shell-command' ? 'shell-command' : 'exact',
      patterns: permAsk.patterns,
      action: permAsk.action,
      duration: grantScope === 'session' ? duration : undefined,
      description: permAsk.question,
      boundRootSessionId: grantScope === 'session' ? boundRootSessionId : undefined,
    },
  }];
}

export function resolveAskAuthority(request: Ask): AskAuthority {
  if (
    request.type === 'client_capability'
    && 'target' in request
    && request.target === 'client'
  ) {
    return {
      visibilityScope: 'global',
      resolutionMode: 'first_eligible',
      requiredCapabilities: [request.capability as ClientCapability],
    };
  }
  return DEFAULT_ASK_AUTHORITY;
}

export function extractResolutionValue(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const record = response as Record<string, unknown>;

  switch (record.type) {
    case 'single_select':
      return record.value;
    case 'multi_select':
      return record.values;
    case 'text':
      return record.value;
    case 'confirm':
      return record.confirmed;
    case 'form':
      return response;
    case 'client_capability':
      return record.result;
    default:
      return response;
  }
}

/** The C6 default advice provider wrapping the exact pre-C6 behavior. */
export function createAskPermissionService(
  createOptions: AskPermissionServiceCreateOptions = {},
): AskPermissionPolicyService {
  const id = createOptions.id ?? 'permission.default';
  const frozenOptions = createOptions.options;

  function options(): AskPermissionPolicyOptions {
    return frozenOptions ?? resolveOptionsLive();
  }

  return {
    id,
    get options(): Readonly<AskPermissionPolicyOptions> {
      return options();
    },
    get askTimeoutMs(): number {
      return options().askTimeoutMs;
    },
    get permissionTimeoutMs(): number {
      return options().permissionTimeoutMs;
    },
    resolveAskAuthority,
    extractResolutionValue,
    isValidPermissionResponse,
    isPermissionApproved,
    isRiskAtOrBelow,
    async shouldAutoApprove(sessionId: string, ask: Ask): Promise<boolean> {
      if (ask.type !== 'permission') return false;
      const risk = (ask as PermissionAsk).risk;
      if (!risk) return false;

      const maxSeverity = await interaction().getSessionAutoApproveSeverity(sessionId);
      if (!maxSeverity || maxSeverity === 'off') return false;
      if (!isRiskAtOrBelow(risk, maxSeverity)) return false;

      console.log(
        `[permissions] Server auto-approve: risk=${risk} maxSeverity=${maxSeverity} session=${sessionId}`,
      );
      return true;
    },
    buildPermissionKey,
    isDangerousShellIdentity,
  };
}

const scopedPolicy = new AsyncLocalStorage<AskPermissionPolicyService>();
let processDefaultPolicy: AskPermissionPolicyService | undefined;

/** Resolves the service seeded for the active agent scope, falling back to
 * one lazily created process-default service for consumers that run outside
 * a composed scope (the current Jean2 server path). */
export function getAskPermissionPolicy(): AskPermissionPolicyService {
  return scopedPolicy.getStore()
    ?? (processDefaultPolicy ??= createAskPermissionService({ id: 'permission.process-default' }));
}

/** The scoped policy only (undefined outside a composed scope). Used by the
 * runtime to prefer the actively seeded advice provider. */
export function getActiveAskPermissionPolicy(): AskPermissionPolicyService | undefined {
  return scopedPolicy.getStore();
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here. */
export function withAskPermissionPolicy<T>(
  service: AskPermissionPolicyService,
  callback: () => T,
): T {
  return scopedPolicy.run(service, callback);
}

/** Test-only reset of the lazily created process default. Exported from this
 * module only; no package subpath re-exports it. */
export function resetDefaultAskPermissionPolicyForTests(): void {
  processDefaultPolicy = undefined;
}
