import type {
  AssistantMessage,
  Jean2PushPayloadV1,
  NotificationEventType,
  Session,
} from '@jean2/sdk';
import { getTerminalNotificationEventId } from '@jean2/sdk';

/**
 * Notification domain: web-push reservation and delivery policy.
 *
 * Pure policy for the notification flows: timing constants, the versioned
 * push payload construction (initial and retry shapes), the terminal-message
 * notification decision (which reuses the scheduling domain's scheduled-run
 * eligibility predicate through injection, never duplicating it), the send
 * result classification, the retry backoff and exhaustion rules, and the
 * delivery cleanup cutoff. The reservation store, the push sender, the
 * pending-dispatch timers, and the retry loop stay in the application and
 * implementation layers.
 */

export const PUSH_DISPATCH_DELAY_MS = 3_000;
export const PUSH_TTL_SECONDS = 2419200; // 28 days max
export const RETRY_INTERVAL_MS = 120_000; // 2 minutes
export const RETRY_BACKOFF_MS = 120_000; // 2 minutes
export const RETRY_NEXT_ATTEMPT_MS = 60_000;
export const MAX_RETRY_ATTEMPTS = 5;
export const DELIVERY_CLEANUP_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function permissionEventId(requestId: string): string {
  return `permission:${requestId}`;
}

// ── Payload construction ─────────────────────────────────────

/** Subscription fields the payload builders need; the domain never imports
 * the store row. */
export interface PushPayloadSubscription {
  client_server_id: string;
}

/** The initial deep-link payload: the route opens the exact session. */
export function buildPushPayloadV1(
  subscription: PushPayloadSubscription,
  eventId: string,
  eventType: NotificationEventType,
  sessionId: string,
  now: number,
): Jean2PushPayloadV1 {
  const route = `/server/${subscription.client_server_id}/workspace/session/${sessionId}`;
  return {
    version: 1,
    eventId,
    type: eventType,
    serverId: subscription.client_server_id,
    sessionId,
    createdAt: now,
    route,
  };
}

/** Delivery row fields the retry payload builder needs. */
export interface RetryDeliveryLike {
  event_id: string;
  event_type: string;
  created_at: number;
}

/** The retry payload: the session id is not stored on the delivery row, so
 * the retry route opens the root session with the known limitation from the
 * pre-domain path (permission events route to the root). */
export function buildRetryPushPayloadV1(
  delivery: RetryDeliveryLike,
  subscription: PushPayloadSubscription,
): Jean2PushPayloadV1 {
  const route = `/server/${subscription.client_server_id}/workspace/session/${
    delivery.event_id.includes('permission:') ? '' : delivery.event_id
  }`;
  return {
    version: 1,
    eventId: delivery.event_id,
    type: delivery.event_type as NotificationEventType,
    serverId: subscription.client_server_id,
    sessionId: '',
    createdAt: delivery.created_at,
    route,
  };
}

// ── Terminal message decision ────────────────────────────────

export type TerminalNotificationDecision =
  | { eventType: 'session_completed' | 'session_failed'; eventId: string }
  | null;

/**
 * Whether an assistant message should produce a terminal notification.
 * Top-level sessions only, assistant role only, no compaction summaries or
 * synthetic messages, and the scheduled-run eligibility comes from the
 * injected predicate (the scheduling domain owns that policy).
 */
export function decideTerminalNotification(
  message: AssistantMessage,
  session: Session | null,
  canNotifyForSession: (session: Session) => boolean,
): TerminalNotificationDecision {
  if (!session) {
    return null;
  }

  if (session.parentId !== null) {
    return null;
  }

  if (message.role !== 'assistant') {
    return null;
  }

  if (message.summary || message.mode === 'compaction') {
    return null;
  }

  if (message.status === 'completed') {
    if (!canNotifyForSession(session)) {
      return null;
    }
    return {
      eventType: 'session_completed',
      eventId: getTerminalNotificationEventId(message.id, 'completed'),
    };
  }

  if (message.status === 'error') {
    if (!canNotifyForSession(session)) {
      return null;
    }
    return {
      eventType: 'session_failed',
      eventId: getTerminalNotificationEventId(message.id, 'error'),
    };
  }

  return null;
}

// ── Send result classification ───────────────────────────────

export interface PushSendResultLike {
  success: boolean;
  statusCode: number;
  body?: string;
}

export type PushSendOutcome =
  | { kind: 'delivered' }
  | { kind: 'stale'; reason: 'invalid_vapid_token' | 'invalid_endpoint' }
  | { kind: 'transient'; error: string }
  | { kind: 'permanent'; error: string };

export function isInvalidVapidToken(statusCode: number, body: string | undefined): boolean {
  return statusCode === 403 && body?.includes('BadJwtToken') === true;
}

/** Classify a first-attempt send result with the exact pre-domain error
 * strings and the stale-subscription deletion rule. */
export function classifyPushSendResult(result: PushSendResultLike): PushSendOutcome {
  if (result.success) {
    return { kind: 'delivered' };
  }

  const badToken = isInvalidVapidToken(result.statusCode, result.body);
  if (result.statusCode === 404 || result.statusCode === 410 || badToken) {
    return {
      kind: 'stale',
      reason: badToken ? 'invalid_vapid_token' : 'invalid_endpoint',
    };
  }

  if (result.statusCode === 0 || result.statusCode === 429 || result.statusCode >= 500) {
    const error = result.statusCode === 0
      ? result.body ?? 'Web Push network error'
      : `HTTP ${result.statusCode}`;
    return { kind: 'transient', error };
  }

  return { kind: 'permanent', error: `HTTP ${result.statusCode}: ${result.body ?? ''}` };
}

// ── Retry policy ─────────────────────────────────────────────

export type RetryAttemptOutcome =
  | { kind: 'delivered' }
  | { kind: 'permanent_4xx'; error: string }
  | { kind: 'exhausted' }
  | { kind: 'retry'; nextAttemptAt: number };

/** Classify one retry attempt. The retry path treats 404/410 as permanent
 * failures (not stale deletion, which only the first attempt performs). */
export function classifyRetryAttempt(
  result: PushSendResultLike,
  attemptCount: number,
  now: number,
): RetryAttemptOutcome {
  if (result.success) {
    return { kind: 'delivered' };
  }

  if (result.statusCode === 404 || result.statusCode === 410) {
    return { kind: 'permanent_4xx', error: `HTTP ${result.statusCode}` };
  }

  if (shouldExhaustRetries(attemptCount)) {
    return { kind: 'exhausted' };
  }

  return { kind: 'retry', nextAttemptAt: retryNextAttemptAt(attemptCount, now) };
}

export function retryNextAttemptAt(attemptCount: number, now: number): number {
  return now + RETRY_BACKOFF_MS * (attemptCount + 1);
}

export function shouldExhaustRetries(attemptCount: number): boolean {
  return attemptCount + 1 >= MAX_RETRY_ATTEMPTS;
}

export function deliveryCleanupCutoff(now: number): number {
  return now - DELIVERY_CLEANUP_AGE_MS;
}

/** Permission dispatch eligibility: the ask must still be pending. */
export function isPendingAskStatus(status: string | null | undefined): status is 'pending' {
  return status === 'pending';
}
