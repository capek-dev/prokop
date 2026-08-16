/**
 * C6 permission runtime: NON-REPLACEABLE lifecycle.
 *
 * Owns the pending-ask and waiter registries, request-id routing, timeout
 * and cleanup, response validation against the module-level validators,
 * raw-audit denial, waiter resolution, canonical grant construction and
 * persistence (module-level `buildGrantParams` with the dangerous-shell
 * once downgrade), and the persistence calls through the interaction host.
 *
 * The replaceable `AskPermissionPolicyService` supplies advice/config only:
 * its validators and grant methods are NEVER consulted for mandatory
 * decisions. A full from-scratch replacement therefore cannot approve
 * malformed or unknown responses on the live resolveAsk path and cannot
 * create grants outside the canonical allowed scopes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type {
  Ask,
  AskApi,
  AskAuthority,
} from '@jean2/sdk';
import { getRuntimeHost } from '../runtime/host';
import type { PendingAskRecord } from '../runtime/host';
import type {
  AskBroadcastFn,
  AskPermissionPolicyService,
  PermissionBroadcastFn,
  PermissionRuntimeService,
  RequestPermissionParams,
} from './contracts';
import {
  buildGrantParams,
  buildPermissionKey,
  getActiveAskPermissionPolicy,
  getAskPermissionPolicy,
  isPermissionApproved,
  isValidPermissionResponse,
  resolveAskAuthority,
  extractResolutionValue,
} from './policy';

export interface PermissionRuntimeCreateOptions {
  id?: string;
  /** The advice provider bound at composition. While a composed scope is
   * entered, the actively seeded provider takes precedence, so unscoped
   * `withAskPermissionPolicy` swaps affect the process runtime too. */
  provider: AskPermissionPolicyService;
}

function interaction() {
  return getRuntimeHost().interaction;
}

interface PendingAsk {
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  ask: Ask;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  broadcastFn: AskBroadcastFn;
  authority: AskAuthority;
}

interface PermissionWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
  sessionId: string;
  toolCallId: string;
  broadcastFn: PermissionBroadcastFn;
}

export function createPermissionRuntimeService(
  createOptions: PermissionRuntimeCreateOptions,
): PermissionRuntimeService {
  const id = createOptions.id ?? 'permission.runtime';
  const boundProvider = createOptions.provider;

  const pendingAsks = new Map<string, PendingAsk>();
  const askTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const waiters = new Map<string, PermissionWaiter>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function activeProvider(): AskPermissionPolicyService {
    return getActiveAskPermissionPolicy() ?? boundProvider;
  }

  // ── Shared record helpers ────────────────────────────────────

  function removePendingAskRecord(requestId: string): void {
    const record = interaction().getPermissionRequestByRequestId(requestId);
    if (record) interaction().removePendingAsk(record.id);
  }

  function clearAskTimer(askId: string): void {
    const timer = askTimers.get(askId);
    if (!timer) return;
    clearTimeout(timer);
    askTimers.delete(askId);
  }

  function clearTimer(requestId: string): void {
    const timer = timers.get(requestId);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(requestId);
  }

  function expirePermissionRequestByRequestId(requestId: string): boolean {
    const record = interaction().getPermissionRequestByRequestId(requestId);
    if (!record || record.status !== 'pending') return false;
    return interaction().expirePermissionRequest(record.id);
  }

  function persistCanonicalGrants(record: PendingAskRecord, response: unknown): void {
    // Canonical construction only: a replacement policy has no grant
    // surface, so out-of-policy scopes can never reach the store.
    if (!isValidPermissionResponse(response) || !isPermissionApproved(response)) return;
    for (const params of buildGrantParams(record, response)) {
      interaction().createGrantFromOptions(params);
    }
  }

  // ── Generic ask lifecycle ────────────────────────────────────

  function createAskApi(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    broadcastFn: AskBroadcastFn,
    workspaceId?: string,
    rootSessionId?: string,
  ): AskApi {
    let askCounter = 0;

    const ask = async (request: Ask): Promise<unknown> => {
      if (request.type === 'permission') {
        return requestPermission({
          sessionId,
          rootSessionId,
          toolCallId,
          toolName,
          ask: request,
          broadcastFn,
          workspaceId,
          timeoutMs: activeProvider().askTimeoutMs,
        });
      }

      const askId = `${toolCallId}#${++askCounter}`;
      const authority = resolveAskAuthority(request);

      return new Promise<unknown>((resolve, reject) => {
        broadcastFn({
          type: 'ask.request',
          sessionId,
          toolCallId,
          toolName,
          ask: request,
          authority,
        });

        pendingAsks.set(askId, {
          resolve,
          reject,
          ask: request,
          sessionId,
          toolCallId,
          toolName,
          broadcastFn,
          authority,
        });

        interaction().createPendingAsk({
          sessionId,
          toolCallId,
          toolName,
          ask: request,
          createdAt: Date.now(),
          requestId: askId,
          status: 'pending',
          isPermission: false,
          workspaceId,
        });

        const timerId = setTimeout(() => {
          if (!pendingAsks.has(askId)) return;
          pendingAsks.delete(askId);
          askTimers.delete(askId);
          removePendingAskRecord(askId);
          broadcastFn({
            type: 'ask.timeout',
            sessionId,
            toolCallId,
          });
          reject(new Error('User did not respond in time'));
        }, activeProvider().askTimeoutMs);
        askTimers.set(askId, timerId);
      });
    };

    return ask as AskApi;
  }

  function resolvePendingAsk(key: string, pending: PendingAsk, response: unknown): boolean {
    clearAskTimer(key);
    pending.resolve(extractResolutionValue(response));
    pendingAsks.delete(key);
    removePendingAskRecord(key);
    return true;
  }

  function resolveAsk(toolCallId: string, response: unknown, requestId?: string): boolean {
    if (requestId) {
      const pending = pendingAsks.get(requestId);
      if (pending) return resolvePendingAsk(requestId, pending, response);
      return resolvePermission(requestId, response);
    }

    const exact = pendingAsks.get(toolCallId);
    if (exact) return resolvePendingAsk(toolCallId, exact, response);

    for (const [key, pending] of pendingAsks) {
      if (key === toolCallId || key.startsWith(`${toolCallId}#`)) {
        return resolvePendingAsk(key, pending, response);
      }
    }
    return false;
  }

  function rejectPendingAsk(key: string, pending: PendingAsk, error: Error): boolean {
    clearAskTimer(key);
    pending.reject(error);
    pendingAsks.delete(key);
    removePendingAskRecord(key);
    return true;
  }

  function rejectAsk(toolCallId: string, error: Error): boolean {
    const exact = pendingAsks.get(toolCallId);
    if (exact) return rejectPendingAsk(toolCallId, exact, error);

    for (const [key, pending] of pendingAsks) {
      if (key === toolCallId || key.startsWith(`${toolCallId}#`)) {
        return rejectPendingAsk(key, pending, error);
      }
    }
    return false;
  }

  function rejectPendingAsksByToolCallId(toolCallId: string, error?: Error): string[] {
    const rejectedIds = rejectPermissionsByToolCallId(toolCallId, error);
    const timeoutError = error ?? new Error('Tool execution ended');

    for (const [askId, pending] of pendingAsks) {
      if (
        pending.toolCallId !== toolCallId
        && askId !== toolCallId
        && !askId.startsWith(`${toolCallId}#`)
      ) {
        continue;
      }
      clearAskTimer(askId);
      pending.broadcastFn({
        type: 'ask.timeout',
        sessionId: pending.sessionId,
        toolCallId: pending.toolCallId,
      });
      pending.reject(timeoutError);
      pendingAsks.delete(askId);
      removePendingAskRecord(askId);
      rejectedIds.push(askId);
    }
    return rejectedIds;
  }

  function rejectPendingAsksBySession(sessionId: string, error?: Error): string[] {
    const rejectedIds = rejectPermissionsBySession(sessionId, error);
    const interruptError = error ?? new Error('Session interrupted');

    for (const [askId, pending] of pendingAsks) {
      if (pending.sessionId !== sessionId) continue;
      clearAskTimer(askId);
      pending.reject(interruptError);
      pendingAsks.delete(askId);
      removePendingAskRecord(askId);
      rejectedIds.push(askId);
    }
    return rejectedIds;
  }

  function hasPendingAsk(toolCallId: string): boolean {
    if (pendingAsks.has(toolCallId)) return true;
    for (const key of pendingAsks.keys()) {
      if (key.startsWith(`${toolCallId}#`)) return true;
    }
    return false;
  }

  function getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined {
    const exact = pendingAsks.get(toolCallId);
    if (exact) return exact.authority;
    for (const [key, pending] of pendingAsks) {
      if (key === toolCallId || key.startsWith(`${toolCallId}#`)) return pending.authority;
    }
    return undefined;
  }

  function getSessionIdForPendingAsk(toolCallId: string, requestId?: string): string | null {
    if (requestId) {
      const record = interaction().getPermissionRequestByRequestId(requestId);
      if (record) return record.sessionId;
    }

    const exact = pendingAsks.get(toolCallId);
    if (exact) return exact.sessionId;
    for (const [key, pending] of pendingAsks) {
      if (key === toolCallId || key.startsWith(`${toolCallId}#`)) return pending.sessionId;
    }

    if (!requestId) {
      const record = interaction().getPermissionRequestByRequestId(toolCallId);
      if (record) return record.sessionId;
    }
    return null;
  }

  const listPendingAsksBySession = (sessionId: string): PendingAskRecord[] =>
    interaction().listPendingAsksBySession(sessionId);
  const listPendingAsksByRootSession = (rootSessionId: string): PendingAskRecord[] =>
    interaction().listPendingAsksByRootSession(rootSessionId);

  // ── Permission lifecycle ─────────────────────────────────────

  async function requestPermission(params: RequestPermissionParams): Promise<unknown> {
    const {
      sessionId,
      rootSessionId,
      workspaceId,
      toolCallId,
      toolName,
      ask,
      broadcastFn,
      timeoutMs = activeProvider().permissionTimeoutMs,
    } = params;
    const isPermissionAsk = ask.type === 'permission';
    const provider = activeProvider();

    if (isPermissionAsk && workspaceId) {
      const permAsk = ask as import('@jean2/sdk').PermissionAsk;
      const effectiveRootSessionId = rootSessionId ?? sessionId;

      if (permAsk.intents && permAsk.intents.length > 0) {
        for (const intent of permAsk.intents) {
          for (const target of intent.targets) {
            const matchResult = interaction().matchGrant({
              workspaceId,
              toolName,
              resource: intent.resource,
              action: intent.action,
              permissionKey: target.target,
              rootSessionId: effectiveRootSessionId,
            });
            if (matchResult.matched) return true;
          }
        }
      }

      const permissionKey = buildPermissionKey(
        toolName,
        permAsk.resource ?? 'file',
        permAsk.patterns,
      );
      const matchResult = interaction().matchGrant({
        workspaceId,
        toolName,
        resource: permAsk.resource ?? 'file',
        permissionKey,
        rootSessionId: effectiveRootSessionId,
      });
      if (matchResult.matched) return true;
    }

    if (provider.shouldAutoApprove(sessionId, ask)) return true;

    const requestId = randomUUID();
    const now = Date.now();
    interaction().createPendingAsk({
      sessionId,
      rootSessionId,
      workspaceId,
      toolCallId,
      toolName,
      ask,
      requestId,
      status: 'pending',
      isPermission: isPermissionAsk,
      expiresAt: now + timeoutMs,
      createdAt: now,
    });

    if (isPermissionAsk) {
      interaction().notifyPermissionRequired(requestId, rootSessionId ?? sessionId);
    }

    broadcastFn({
      type: 'ask.request',
      sessionId,
      toolCallId,
      toolName,
      ask,
      requestId,
      authority: {
        visibilityScope: 'controller_only',
        resolutionMode: 'controller_only',
      },
    });

    return new Promise<unknown>((resolve, reject) => {
      waiters.set(requestId, {
        resolve,
        reject,
        createdAt: now,
        sessionId,
        toolCallId,
        broadcastFn,
      });

      const timerId = setTimeout(() => {
        if (!waiters.has(requestId)) return;
        waiters.delete(requestId);
        timers.delete(requestId);
        expirePermissionRequestByRequestId(requestId);
        broadcastFn({
          type: 'ask.timeout',
          sessionId,
          toolCallId,
          requestId,
        });
        reject(new Error('User did not respond in time'));
      }, timeoutMs);
      timers.set(requestId, timerId);
    });
  }

  function resolvePermission(requestId: string, response: unknown): boolean {
    const waiter = waiters.get(requestId);
    // Mandatory validation from the module-level validator, never from
    // provider advice.
    const approved = isPermissionApproved(response);

    if (!waiter) {
      const record = interaction().getPermissionRequestByRequestId(requestId);
      if (record?.status === 'pending') {
        interaction().resolvePermissionRequestByRequestId(
          requestId,
          approved ? 'approved' : 'denied',
          response,
        );
      }
      return false;
    }

    clearTimer(requestId);
    const record = interaction().getPermissionRequestByRequestId(requestId);
    if (record?.status === 'pending') {
      interaction().resolvePermissionRequestByRequestId(
        requestId,
        approved ? 'approved' : 'denied',
        response,
      );
      if (approved && record.isPermission) {
        persistCanonicalGrants(record, response);
      }
    }

    waiter.resolve(record?.isPermission ? approved : false);
    waiters.delete(requestId);
    return true;
  }

  function rejectPermission(requestId: string, error: Error): boolean {
    const waiter = waiters.get(requestId);
    if (!waiter) return false;
    clearTimer(requestId);
    waiter.reject(error);
    waiters.delete(requestId);
    return true;
  }

  function rejectPermissionsByToolCallId(toolCallId: string, error?: Error): string[] {
    const rejectedIds: string[] = [];
    const timeoutError = error ?? new Error('Tool execution ended');

    for (const [requestId, waiter] of waiters) {
      if (waiter.toolCallId !== toolCallId) continue;
      clearTimer(requestId);
      expirePermissionRequestByRequestId(requestId);
      waiter.broadcastFn({
        type: 'ask.timeout',
        sessionId: waiter.sessionId,
        toolCallId: waiter.toolCallId,
        requestId,
      });
      waiter.reject(timeoutError);
      waiters.delete(requestId);
      rejectedIds.push(requestId);
    }
    return rejectedIds;
  }

  function rejectPermissionsBySession(sessionId: string, error?: Error): string[] {
    const rejectedIds: string[] = [];
    const interruptError = error ?? new Error('Session interrupted');
    interaction().cancelPendingRequestsBySession(sessionId);

    for (const [requestId, waiter] of waiters) {
      const record = interaction().getPermissionRequestByRequestId(requestId);
      if (record?.sessionId !== sessionId) continue;
      clearTimer(requestId);
      waiter.broadcastFn({
        type: 'ask.timeout',
        sessionId: waiter.sessionId,
        toolCallId: waiter.toolCallId,
        requestId,
      });
      waiter.reject(interruptError);
      waiters.delete(requestId);
      rejectedIds.push(requestId);
    }
    return rejectedIds;
  }

  const getPendingRequestsByRootSession = (rootSessionId: string): PendingAskRecord[] =>
    interaction().listPendingRequestsByRootSession(rootSessionId);

  function expireOldRequests(maxAgeMs: number): number {
    const count = interaction().expireOldPermissionRequests(maxAgeMs);
    const cutoff = Date.now() - maxAgeMs;
    for (const [requestId, waiter] of waiters) {
      if (waiter.createdAt >= cutoff) continue;
      clearTimer(requestId);
      waiter.reject(new Error('Permission request expired'));
      waiters.delete(requestId);
    }
    return count;
  }

  const hasPendingWaiter = (requestId: string): boolean => waiters.has(requestId);
  const getPendingWaiterCount = (): number => waiters.size;

  return {
    id,
    get provider(): AskPermissionPolicyService {
      return activeProvider();
    },
    createAskApi,
    resolveAsk,
    rejectAsk,
    rejectPendingAsksByToolCallId,
    rejectPendingAsksBySession,
    hasPendingAsk,
    getAuthorityForPendingAsk,
    getSessionIdForPendingAsk,
    listPendingAsksBySession,
    listPendingAsksByRootSession,
    requestPermission,
    resolvePermission,
    rejectPermission,
    rejectPermissionsByToolCallId,
    rejectPermissionsBySession,
    getPendingRequestsByRootSession,
    expireOldRequests,
    hasPendingWaiter,
    getPendingWaiterCount,
  };
}

const scopedRuntime = new AsyncLocalStorage<PermissionRuntimeService>();
let processDefaultRuntime: PermissionRuntimeService | undefined;

/** Resolves the runtime seeded for the active agent scope, falling back to
 * one lazily created process-default runtime over the process-default
 * advice provider. The runtime is non-replaceable: only the advice provider
 * behind it can be swapped. */
export function getPermissionRuntimeService(): PermissionRuntimeService {
  return scopedRuntime.getStore()
    ?? (processDefaultRuntime ??= createPermissionRuntimeService({
      id: 'permission.process-runtime',
      provider: getAskPermissionPolicy(),
    }));
}

/** Seeds a runtime for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's runtime here. */
export function withPermissionRuntimeService<T>(
  service: PermissionRuntimeService,
  callback: () => T,
): T {
  return scopedRuntime.run(service, callback);
}

/** Test-only reset of the lazily created process default. Exported from this
 * module only; no package subpath re-exports it. */
export function resetDefaultPermissionRuntimeForTests(): void {
  processDefaultRuntime = undefined;
}
