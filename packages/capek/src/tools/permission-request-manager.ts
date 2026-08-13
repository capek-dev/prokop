import type {
  Ask,
  AskAuthority,
  AskPermissionResponse,
  AskRequestMessage,
  AskTimedOutMessage,
  GrantScope,
  PermissionAsk,
  PermissionIntent,
  PermissionRiskLevel,
} from '@jean2/sdk';
import {
  SHELL_DANGEROUS_COMMANDS,
  SHELL_FILESYSTEM_COMMANDS,
} from '@jean2/sdk';
import { getJean2CompatibilityBindings } from '../compat/bindings';
import type { PendingAskRecord } from '../compat/bindings';

interface PermissionWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  createdAt: number;
  sessionId: string;
  toolCallId: string;
  broadcastFn: PermissionBroadcastFn;
}

const waiters = new Map<string, PermissionWaiter>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const PERMISSION_TIMEOUT = 30 * 60 * 1000;

const DEFAULT_ASK_AUTHORITY: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

export type PermissionBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;

const RISK_ORDER: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];
const VALID_GRANT_SCOPES: GrantScope[] = ['once', 'session', 'workspace'];

function interaction() {
  return getJean2CompatibilityBindings().interaction;
}

function isRiskAtOrBelow(risk: PermissionRiskLevel, max: PermissionRiskLevel): boolean {
  return RISK_ORDER.indexOf(risk) <= RISK_ORDER.indexOf(max);
}

function tryServerAutoApprove(sessionId: string, ask: Ask): boolean {
  if (ask.type !== 'permission') return false;
  const risk = (ask as PermissionAsk).risk;
  if (!risk) return false;

  const maxSeverity = interaction().getSessionAutoApproveSeverity(sessionId);
  if (!maxSeverity || maxSeverity === 'off') return false;
  if (!isRiskAtOrBelow(risk, maxSeverity)) return false;

  console.log(
    `[permissions] Server auto-approve: risk=${risk} maxSeverity=${maxSeverity} session=${sessionId}`,
  );
  return true;
}

function buildPermissionKey(
  toolName: string,
  resource: string | undefined,
  patterns: string[] | undefined,
): string {
  if (patterns && patterns.length > 0) return patterns[0];
  if (resource) return resource;
  return toolName;
}

function isDangerousShellIdentity(identity: string | undefined): boolean {
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

function isValidPermissionResponse(response: unknown): response is AskPermissionResponse {
  if (!response || typeof response !== 'object') return false;
  const record = response as Record<string, unknown>;
  return record.type === 'permission' && VALID_GRANT_SCOPES.includes(record.grant as GrantScope);
}

function isPermissionApproved(response: unknown): boolean {
  return isValidPermissionResponse(response) && response.grant !== 'deny';
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

export async function requestPermission(params: RequestPermissionParams): Promise<unknown> {
  const {
    sessionId,
    rootSessionId,
    workspaceId,
    toolCallId,
    toolName,
    ask,
    broadcastFn,
    timeoutMs = interaction().getPermissionTimeoutMs(),
  } = params;
  const isPermissionAsk = ask.type === 'permission';

  if (isPermissionAsk && workspaceId) {
    const permAsk = ask as PermissionAsk;
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

  if (tryServerAutoApprove(sessionId, ask)) return true;

  const requestId = crypto.randomUUID();
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
    authority: DEFAULT_ASK_AUTHORITY,
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

export function resolvePermission(requestId: string, response: unknown): boolean {
  const waiter = waiters.get(requestId);
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
    if (approved && record.isPermission && isValidPermissionResponse(response)) {
      persistGrant(response, record);
    }
  }

  waiter.resolve(record?.isPermission ? approved : false);
  waiters.delete(requestId);
  return true;
}

export function rejectPermission(requestId: string, error: Error): boolean {
  const waiter = waiters.get(requestId);
  if (!waiter) return false;
  clearTimer(requestId);
  waiter.reject(error);
  waiters.delete(requestId);
  return true;
}

export function rejectPermissionsByToolCallId(toolCallId: string, error?: Error): string[] {
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

export function rejectPermissionsBySession(sessionId: string, error?: Error): string[] {
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

export function getPendingRequestsByRootSession(rootSessionId: string): PendingAskRecord[] {
  return interaction().listPendingRequestsByRootSession(rootSessionId);
}

export function expireOldRequests(maxAgeMs: number): number {
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

function persistGrant(response: AskPermissionResponse, record: PendingAskRecord): void {
  if (!record.workspaceId || response.grant === 'deny') return;
  const permAsk = record.ask as PermissionAsk;
  let grantScope: GrantScope = response.grant;
  const boundRootSessionId = record.rootSessionId ?? record.sessionId;

  if (permAsk.intents && permAsk.intents.length > 0) {
    const intent: PermissionIntent = permAsk.intents[0];
    if (!intent.allowedScopes.includes(grantScope) || grantScope === 'once') return;
    const duration = response.duration || (grantScope === 'session' ? 30 * 60 * 1000 : undefined);

    for (const target of intent.targets) {
      interaction().createGrantFromOptions({
        workspaceId: record.workspaceId,
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
      });
    }
    return;
  }

  const metadata = permAsk.metadata as Record<string, unknown> | undefined;
  const identity = typeof metadata?.baseCommand === 'string' ? metadata.baseCommand : undefined;
  if (permAsk.resource === 'shell-command' && isDangerousShellIdentity(identity)) {
    grantScope = 'once';
  }
  const duration = response.duration || (grantScope === 'session' ? 30 * 60 * 1000 : undefined);
  interaction().createGrantFromOptions({
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
  });
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

export function hasPendingWaiter(requestId: string): boolean {
  return waiters.has(requestId);
}

export function getPendingWaiterCount(): number {
  return waiters.size;
}
