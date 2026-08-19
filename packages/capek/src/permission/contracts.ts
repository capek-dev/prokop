/**
 * C6 permission policy contracts.
 *
 * The agent-scoped permission surface is split into two contracts:
 *
 * - `AskPermissionPolicyService` (REPLACEABLE advice/config): frozen
 *   timeouts, authority and value extraction, the response validators, the
 *   auto-approval bound, permission-key derivation, and dangerous-shell
 *   detection. A custom provider may replace all of these, but its advice
 *   can never change a mandatory decision: the runtime owns denial and
 *   grant construction.
 * - `PermissionRuntimeService` (NON-REPLACEABLE lifecycle): request-id
 *   routing, pending-ask and waiter registries, timeouts and cleanup,
 *   response validation against the module-level validators, raw-audit
 *   denial, waiter resolution, canonical grant construction and persistence
 *   (module-level `buildGrantParams` with the dangerous-shell once
 *   downgrade), and the persistence calls through the interaction host.
 *
 * The Jean2 adapters keep persistence, WebSocket delivery, notifications,
 * and controller authority: every host-facing operation goes through the
 * `InteractionHost` installed by the compatibility bindings.
 */

import type { Ask, AskApi, AskPermissionResponse } from '@capekai/tool';
import type { PermissionRiskLevel } from '@capekai/tool';
import type { AskAuthority, AskRequestMessage, AskTimedOutMessage, ClientCapability } from '@capekai/types';
import type { PendingAskRecord } from '../runtime/host';

/** Provider options translated at composition. The generic ask timeout has
 * no current configuration source and stays the fixed 5-minute constant;
 * the permission timeout translates from the composed runtime host's
 * `getPermissionTimeoutMs()`. */
export interface AskPermissionPolicyOptions {
  askTimeoutMs: number;
  permissionTimeoutMs: number;
}

export interface RequestPermissionParams {
  sessionId: string;
  rootSessionId?: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  broadcastFn: PermissionBroadcastFn;
  timeoutMs?: number;
}

export type AskBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;
export type PermissionBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;

/**
 * Replaceable permission advice and configuration. Every method is pure
 * advice over the injected interaction host; the runtime never trusts these
 * methods for mandatory denial or grant decisions.
 */
export interface AskPermissionPolicyService {
  readonly id: string;
  /** Frozen provider options. */
  readonly options: Readonly<AskPermissionPolicyOptions>;
  readonly askTimeoutMs: number;
  readonly permissionTimeoutMs: number;
  /** Authority for a generic ask: capability asks targeting the client
   * resolve to global/first_eligible with the required capability; every
   * other ask keeps the controller-only default. */
  resolveAskAuthority(request: Ask): AskAuthority;
  /** Extracts the resolved value from a shaped generic response. */
  extractResolutionValue(response: unknown): unknown;
  /** A permission response is only valid when it is shaped
   * `{ type: 'permission', grant: 'once' | 'session' | 'workspace' | 'deny' }`. */
  isValidPermissionResponse(response: unknown): response is AskPermissionResponse;
  /** True for a valid non-deny permission response. */
  isPermissionApproved(response: unknown): boolean;
  /** Risk ordering check used for auto-approval bounds. */
  isRiskAtOrBelow(risk: PermissionRiskLevel, max: PermissionRiskLevel): boolean;
  /** Server auto-approval advice: true when the session severity is above
   * off/undefined and the ask's risk is within it. */
  shouldAutoApprove(sessionId: string, ask: Ask): Promise<boolean>;
  /** Permission key precedence: first pattern, then resource, then tool name. */
  buildPermissionKey(
    toolName: string,
    resource: string | undefined,
    patterns: string[] | undefined,
  ): string;
  /** Dangerous shell identity detection advice. */
  isDangerousShellIdentity(identity: string | undefined): boolean;
}

/**
 * Non-replaceable permission runtime and lifecycle. Owns the pending-ask
 * and waiter registries, request-id routing, timeout/cleanup, response
 * validation, raw-audit denial, waiter resolution, and canonical grant
 * construction/persistence.
 */
export interface PermissionRuntimeService {
  readonly id: string;
  /** The advice provider currently active for this runtime (the scoped
   * provider while a scope is entered, otherwise the bound provider). */
  readonly provider: AskPermissionPolicyService;

  // Generic ask lifecycle (former tools/ask-user-api.ts surface).
  createAskApi(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    broadcastFn: AskBroadcastFn,
    workspaceId?: string,
    rootSessionId?: string,
  ): AskApi;
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  rejectAsk(toolCallId: string, error: Error): Promise<boolean>;
  rejectPendingAsksByToolCallId(toolCallId: string, error?: Error): Promise<string[]>;
  rejectPendingAsksBySession(sessionId: string, error?: Error): Promise<string[]>;
  hasPendingAsk(toolCallId: string): boolean;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  listPendingAsksBySession(sessionId: string): Promise<PendingAskRecord[]>;
  listPendingAsksByRootSession(rootSessionId: string): Promise<PendingAskRecord[]>;

  // Permission lifecycle (former tools/permission-request-manager.ts surface).
  requestPermission(params: RequestPermissionParams): Promise<unknown>;
  resolvePermission(requestId: string, response: unknown): Promise<boolean>;
  rejectPermission(requestId: string, error: Error): boolean;
  rejectPermissionsByToolCallId(toolCallId: string, error?: Error): Promise<string[]>;
  rejectPermissionsBySession(sessionId: string, error?: Error): Promise<string[]>;
  getPendingRequestsByRootSession(rootSessionId: string): Promise<PendingAskRecord[]>;
  expireOldRequests(maxAgeMs: number): Promise<number>;
  hasPendingWaiter(requestId: string): boolean;
  getPendingWaiterCount(): number;
}

/** Capability-ask authority carrying the required client capability. */
export type CapabilityAskAuthority = AskAuthority & {
  requiredCapabilities?: ClientCapability[];
};
