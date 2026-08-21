import { describe, expect, test } from 'bun:test';
import type { AssistantMessage, Session } from '@prokopai/sdk';
import {
  buildPushPayloadV1,
  buildRetryPushPayloadV1,
  classifyPushSendResult,
  classifyRetryAttempt,
  decideTerminalNotification,
  deliveryCleanupCutoff,
  DELIVERY_CLEANUP_AGE_MS,
  isInvalidVapidToken,
  isPendingAskStatus,
  MAX_RETRY_ATTEMPTS,
  permissionEventId,
  PUSH_DISPATCH_DELAY_MS,
  PUSH_TTL_SECONDS,
  RETRY_BACKOFF_MS,
  RETRY_INTERVAL_MS,
  RETRY_NEXT_ATTEMPT_MS,
  retryNextAttemptAt,
  shouldExhaustRetries,
} from '@/domains/notifications';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as Session;
}

function makeMessage(overrides: Record<string, unknown> = {}): AssistantMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    status: 'completed',
    modelId: 'm',
    providerId: 'p',
    tokens: { prompt: 0, completion: 0 },
    cost: 0,
    createdAt: 1,
    completedAt: 2,
    ...overrides,
  } as AssistantMessage;
}

describe('notification domain: timing and payload policy', () => {
  test('pins the exact timing constants', () => {
    expect(PUSH_DISPATCH_DELAY_MS).toBe(3_000);
    expect(PUSH_TTL_SECONDS).toBe(2419200);
    expect(RETRY_INTERVAL_MS).toBe(120_000);
    expect(RETRY_BACKOFF_MS).toBe(120_000);
    expect(RETRY_NEXT_ATTEMPT_MS).toBe(60_000);
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
    expect(DELIVERY_CLEANUP_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(permissionEventId('req-1')).toBe('permission:req-1');
  });

  test('builds the exact initial deep-link payload', () => {
    expect(buildPushPayloadV1(
      { client_server_id: 'srv-1' },
      'message:m1:completed',
      'session_completed',
      'sess-1',
      1234,
    )).toEqual({
      version: 1,
      eventId: 'message:m1:completed',
      type: 'session_completed',
      serverId: 'srv-1',
      sessionId: 'sess-1',
      createdAt: 1234,
      route: '/server/srv-1/workspace/session/sess-1',
    });
  });

  test('builds the exact retry payload with the root-session route limitation', () => {
    const completion = buildRetryPushPayloadV1(
      { event_id: 'message:m1:completed', event_type: 'session_completed', created_at: 99 },
      { client_server_id: 'srv-1' },
    );
    expect(completion).toEqual({
      version: 1,
      eventId: 'message:m1:completed',
      type: 'session_completed',
      serverId: 'srv-1',
      sessionId: '',
      createdAt: 99,
      route: '/server/srv-1/workspace/session/message:m1:completed',
    });

    const permission = buildRetryPushPayloadV1(
      { event_id: 'permission:req-1', event_type: 'permission_required', created_at: 99 },
      { client_server_id: 'srv-1' },
    );
    expect(permission.route).toBe('/server/srv-1/workspace/session/');
  });
});

describe('notification domain: terminal message decision', () => {
  test('notifies only top-level assistant terminal messages', () => {
    const notify = () => true;

    expect(decideTerminalNotification(makeMessage(), makeSession(), notify))
      .toEqual({ eventType: 'session_completed', eventId: 'message:msg-1:completed' });
    expect(decideTerminalNotification(makeMessage({ status: 'error' }), makeSession(), notify))
      .toEqual({ eventType: 'session_failed', eventId: 'message:msg-1:error' });

    // Child sessions, other roles, and compaction summaries are excluded.
    expect(decideTerminalNotification(makeMessage(), makeSession({ parentId: 'parent' }), notify)).toBeNull();
    expect(decideTerminalNotification(makeMessage({ role: 'user' }), makeSession(), notify)).toBeNull();
    expect(decideTerminalNotification(makeMessage({ summary: 'sum' }), makeSession(), notify)).toBeNull();
    expect(decideTerminalNotification(makeMessage({ mode: 'compaction' }), makeSession(), notify)).toBeNull();
    expect(decideTerminalNotification(makeMessage({ status: 'streaming' }), makeSession(), notify)).toBeNull();
    expect(decideTerminalNotification(makeMessage(), null, notify)).toBeNull();
  });

  test('applies the injected scheduled-run eligibility predicate', () => {
    const session = makeSession();
    expect(decideTerminalNotification(makeMessage(), session, () => false)).toBeNull();
    expect(decideTerminalNotification(makeMessage(), session, () => true)).not.toBeNull();
  });
});

describe('notification domain: send and retry classification', () => {
  test('classifies first-attempt results with the exact error strings', () => {
    expect(classifyPushSendResult({ success: true, statusCode: 201 })).toEqual({ kind: 'delivered' });

    expect(classifyPushSendResult({ success: false, statusCode: 404 }))
      .toEqual({ kind: 'stale', reason: 'invalid_endpoint' });
    expect(classifyPushSendResult({ success: false, statusCode: 410 }))
      .toEqual({ kind: 'stale', reason: 'invalid_endpoint' });
    expect(classifyPushSendResult({ success: false, statusCode: 403, body: 'BadJwtToken expired' }))
      .toEqual({ kind: 'stale', reason: 'invalid_vapid_token' });

    expect(classifyPushSendResult({ success: false, statusCode: 429 }))
      .toEqual({ kind: 'transient', error: 'HTTP 429' });
    expect(classifyPushSendResult({ success: false, statusCode: 503 }))
      .toEqual({ kind: 'transient', error: 'HTTP 503' });
    expect(classifyPushSendResult({ success: false, statusCode: 0, body: 'network down' }))
      .toEqual({ kind: 'transient', error: 'network down' });
    expect(classifyPushSendResult({ success: false, statusCode: 0 }))
      .toEqual({ kind: 'transient', error: 'Web Push network error' });

    expect(classifyPushSendResult({ success: false, statusCode: 400, body: 'bad payload' }))
      .toEqual({ kind: 'permanent', error: 'HTTP 400: bad payload' });
    expect(isInvalidVapidToken(403, 'BadJwtToken')).toBe(true);
    expect(isInvalidVapidToken(403, 'nope')).toBe(false);
  });

  test('classifies retry attempts with backoff and exhaustion', () => {
    expect(classifyRetryAttempt({ success: true, statusCode: 201 }, 0, 1000)).toEqual({ kind: 'delivered' });
    expect(classifyRetryAttempt({ success: false, statusCode: 404 }, 0, 1000))
      .toEqual({ kind: 'permanent_4xx', error: 'HTTP 404' });
    expect(classifyRetryAttempt({ success: false, statusCode: 503 }, 4, 1000))
      .toEqual({ kind: 'exhausted' });
    expect(classifyRetryAttempt({ success: false, statusCode: 503 }, 1, 1000))
      .toEqual({ kind: 'retry', nextAttemptAt: 1000 + RETRY_BACKOFF_MS * 2 });

    expect(retryNextAttemptAt(0, 500)).toBe(500 + RETRY_BACKOFF_MS);
    expect(shouldExhaustRetries(4)).toBe(true);
    expect(shouldExhaustRetries(3)).toBe(false);
  });

  test('computes the cleanup cutoff and the pending-ask gate', () => {
    const now = 10_000;
    expect(deliveryCleanupCutoff(now)).toBe(now - DELIVERY_CLEANUP_AGE_MS);
    expect(isPendingAskStatus('pending')).toBe(true);
    expect(isPendingAskStatus('approved')).toBe(false);
    expect(isPendingAskStatus(null)).toBe(false);
  });
});
