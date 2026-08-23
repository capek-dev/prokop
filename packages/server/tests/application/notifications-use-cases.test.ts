import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssistantMessage, PushSubscriptionRecord, Session } from '@prokopai/sdk';
import {
  createNotificationsApplication,
  type NotificationsApplication,
} from '@/application/notifications';
import type {
  NotificationDeliveryRow,
  NotificationSenderPort,
  NotificationStorePort,
  NotificationsApplicationDeps,
} from '@/application/ports/notifications';

function makeRecord(overrides: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord {
  return {
    id: 'sub-1',
    clientId: 'client-1',
    clientServerId: 'srv-1',
    clientOrigin: 'https://app.example.com',
    expirationTime: null,
    preferences: { completion: true, permission: true },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeSubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    client_id: 'client-1',
    client_server_id: 'srv-1',
    client_origin: 'https://app.example.com',
    endpoint: 'https://push.example.com/endpoint',
    p256dh: 'p256dh',
    auth: 'auth',
    expiration_time: null,
    notify_completion: 1,
    notify_permission: 1,
    created_at: 0,
    updated_at: 0,
    last_success_at: null,
    last_failure_at: null,
    last_failure_reason: null,
    ...overrides,
  };
}

interface FakeState {
  subscriptions: ReturnType<typeof makeSubRow>[];
  deliveries: Map<string, NotificationDeliveryRow>;
  sent: Array<{ endpoint: string; payload: string }>;
  sendResult: { success: boolean; statusCode: number; body?: string };
  log: string[];
}

function makeState(): FakeState {
  return {
    subscriptions: [makeSubRow()],
    deliveries: new Map(),
    sent: [],
    sendResult: { success: true, statusCode: 201 },
    log: [],
  };
}

function makeDeps(state: FakeState, overrides: Partial<NotificationsApplicationDeps> = {}): NotificationsApplicationDeps {
  const store: NotificationStorePort = {
    upsertSubscription: (input) => {
      state.log.push(`upsert:${input.clientId}`);
      return makeRecord();
    },
    updatePreferences: (id) => {
      state.log.push(`updatePrefs:${id}`);
      return id === 'sub-1' ? makeRecord({ preferences: { completion: false, permission: true } }) : null;
    },
    deleteSubscription: (id) => {
      state.log.push(`delete:${id}`);
      return true;
    },
    listEnabledForEvent: (eventType) => {
      state.log.push(`listEnabled:${eventType}`);
      return state.subscriptions;
    },
    getForDispatch: (id) => {
      state.log.push(`getForDispatch:${id}`);
      return state.subscriptions.find((sub) => sub.id === id) ?? null;
    },
    reserveDelivery: (input) => {
      state.log.push(`reserve:${input.eventId}:${input.subscriptionId}`);
      const key = `${input.eventId}:${input.subscriptionId}`;
      if (state.deliveries.has(key)) return false;
      state.deliveries.set(key, {
        event_id: input.eventId,
        subscription_id: input.subscriptionId,
        event_type: input.eventType,
        status: 'pending_retry',
        attempt_count: 0,
        created_at: 0,
        attempted_at: null,
        next_attempt_at: null,
        delivered_at: null,
        error: null,
      });
      return true;
    },
    markDelivered: (eventId, subscriptionId) => {
      state.log.push(`delivered:${eventId}:${subscriptionId}`);
    },
    markFailed: (eventId, subscriptionId, error) => {
      state.log.push(`failed:${eventId}:${subscriptionId}:${error}`);
    },
    markRetryable: (eventId, subscriptionId, error, nextAttemptAt) => {
      state.log.push(`retryable:${eventId}:${subscriptionId}:${error}:${nextAttemptAt}`);
    },
    markExhausted: (eventId, subscriptionId) => {
      state.log.push(`exhausted:${eventId}:${subscriptionId}`);
    },
    deleteStaleSubscription: (id) => {
      state.log.push(`stale:${id}`);
      state.subscriptions = state.subscriptions.filter((sub) => sub.id !== id);
    },
    getDueForRetry: () => {
      state.log.push('dueForRetry');
      return [...state.deliveries.values()];
    },
    deleteOldDeliveries: (olderThan) => {
      state.log.push(`deleteOld:${olderThan}`);
      return 0;
    },
    deleteAllOldDeliveries: (olderThan) => {
      state.log.push(`deleteAllOld:${olderThan}`);
      return 1;
    },
  };

  const sender: NotificationSenderPort = {
    send: async (input) => {
      state.sent.push({ endpoint: input.endpoint, payload: input.payload });
      return state.sendResult;
    },
    config: () => ({ available: true, vapidPublicKey: 'public' }),
  };

  return {
    store,
    sender,
    getSession: (id) => (id === 'sess-1'
      ? ({ id: 'sess-1', parentId: null, metadata: null } as Session)
      : null),
    canNotifyForSession: () => true,
    getPendingAsk: (requestId) => (requestId === 'pending-req' ? { status: 'pending' } : { status: 'resolved' }),
    permissionTimeoutMs: () => 1_800_000,
    getControllerClientId: () => null,
    ...overrides,
  };
}

interface PatchedTimers {
  timeouts: Array<{ callback: () => void; delay: number }>;
  cleared: number;
  restore(): void;
}

function patchTimers(): PatchedTimers {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const state: PatchedTimers = {
    timeouts: [],
    cleared: 0,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    state.timeouts.push({ callback, delay });
    return state.timeouts.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {
    state.cleared += 1;
  }) as typeof clearTimeout;
  return state;
}

function makeMessage(status: 'completed' | 'error' = 'completed'): AssistantMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    status,
    modelId: 'm',
    providerId: 'p',
    tokens: { prompt: 0, completion: 0 },
    cost: 0,
    createdAt: 1,
    completedAt: 2,
  } as AssistantMessage;
}

function makeApplication(state: FakeState, deps?: NotificationsApplicationDeps): NotificationsApplication {
  return createNotificationsApplication(deps ?? makeDeps(state));
}

describe('notifications application use cases', () => {
  let state: FakeState;

  beforeEach(() => {
    state = makeState();
  });

  afterEach(() => {
    // No persistent state; timers are patched per test.
  });

  test('getConfig composes the sender config with the permission timeout', () => {
    const application = makeApplication(state);
    expect(application.getConfig()).toEqual({
      available: true,
      vapidPublicKey: 'public',
      permissionTimeoutMs: 1_800_000,
    });
  });

  test('subscription use cases delegate to the store', () => {
    const application = makeApplication(state);
    expect(application.upsertSubscription({
      clientId: 'c',
      clientServerId: 's',
      clientOrigin: 'https://o',
      subscription: { endpoint: 'https://e', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } },
      preferences: { completion: true, permission: true },
    }).id).toBe('sub-1');
    expect(application.updatePreferences('sub-1', { completion: false, permission: true })?.preferences.completion).toBe(false);
    expect(application.updatePreferences('missing', { completion: false, permission: true })).toBeNull();
    application.deleteSubscription('sub-1');
    expect(state.log).toEqual([
      'upsert:c',
      'updatePrefs:sub-1',
      'updatePrefs:missing',
      'delete:sub-1',
    ]);
  });

  test('dispatch reserves, sends, and marks delivered', async () => {
    const application = makeApplication(state);
    await application.dispatch({ eventId: 'e1', eventType: 'session_completed', sessionId: 'sess-1' });

    expect(state.sent).toHaveLength(1);
    expect(JSON.parse(state.sent[0].payload)).toMatchObject({
      version: 1,
      eventId: 'e1',
      type: 'session_completed',
      sessionId: 'sess-1',
      route: '/server/srv-1/workspace/session/sess-1',
    });
    expect(state.log).toContain('reserve:e1:sub-1');
    expect(state.log).toContain('delivered:e1:sub-1');

    // Duplicate dispatch is idempotent: no second send.
    await application.dispatch({ eventId: 'e1', eventType: 'session_completed', sessionId: 'sess-1' });
    expect(state.sent).toHaveLength(1);
  });

  test('dispatch delivers only to the controller client subscriptions', async () => {
    state.subscriptions = [
      makeSubRow({ id: 'sub-desktop', client_id: 'client-desktop' }),
      makeSubRow({ id: 'sub-phone', client_id: 'client-phone', endpoint: 'https://push.example.com/phone' }),
    ];
    const application = makeApplication(state, makeDeps(state, {
      getControllerClientId: (sessionId) => (sessionId === 'sess-1' ? 'client-desktop' : null),
    }));

    await application.dispatch({ eventId: 'e-ctrl', eventType: 'session_completed', sessionId: 'sess-1' });

    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].endpoint).toBe('https://push.example.com/endpoint');
    expect(state.log).toContain('delivered:e-ctrl:sub-desktop');
    expect(state.log.some((entry) => entry.includes('sub-phone'))).toBe(false);
  });

  test('dispatch fans out to all subscriptions when the session is uncontrolled', async () => {
    state.subscriptions = [
      makeSubRow({ id: 'sub-desktop', client_id: 'client-desktop' }),
      makeSubRow({ id: 'sub-phone', client_id: 'client-phone', endpoint: 'https://push.example.com/phone' }),
    ];
    const application = makeApplication(state, makeDeps(state, {
      getControllerClientId: () => null,
    }));

    await application.dispatch({ eventId: 'e-free', eventType: 'session_completed', sessionId: 'sess-1' });

    expect(state.sent).toHaveLength(2);
    expect(state.log).toContain('delivered:e-free:sub-desktop');
    expect(state.log).toContain('delivered:e-free:sub-phone');
  });

  test('dispatch skips when the controller has no enabled subscriptions', async () => {
    state.subscriptions = [
      makeSubRow({ id: 'sub-phone', client_id: 'client-phone' }),
    ];
    const application = makeApplication(state, makeDeps(state, {
      getControllerClientId: () => 'client-desktop',
    }));

    await application.dispatch({ eventId: 'e-none', eventType: 'session_completed', sessionId: 'sess-1' });

    expect(state.sent).toHaveLength(0);
  });

  test('dispatch deletes stale subscriptions and marks transient and permanent failures', async () => {
    state.sendResult = { success: false, statusCode: 404 };
    const application = makeApplication(state);
    await application.dispatch({ eventId: 'e-stale', eventType: 'session_completed', sessionId: 'sess-1' });
    expect(state.log).toContain('stale:sub-1');
    expect(state.subscriptions).toHaveLength(0);

    state.subscriptions = [makeSubRow()];
    state.deliveries.clear();
    state.sendResult = { success: false, statusCode: 429 };
    await application.dispatch({ eventId: 'e-429', eventType: 'session_completed', sessionId: 'sess-1' });
    expect(state.log.some((entry) => entry.startsWith('retryable:e-429:sub-1:HTTP 429:'))).toBe(true);

    state.subscriptions = [makeSubRow()];
    state.deliveries.clear();
    state.sendResult = { success: false, statusCode: 400, body: 'bad' };
    await application.dispatch({ eventId: 'e-400', eventType: 'session_completed', sessionId: 'sess-1' });
    expect(state.log).toContain('failed:e-400:sub-1:HTTP 400: bad');
  });

  test('terminal notifications schedule after the exact delay and acknowledge suppresses', () => {
    const timers = patchTimers();
    try {
      const application = makeApplication(state);
      application.notifyTerminalMessage(makeMessage(), 'sess-1');

      expect(timers.timeouts).toEqual([{ callback: expect.any(Function), delay: 3000 }]);
      expect(application.acknowledgePendingNotification('message:msg-1:completed', 'sess-1', 'client-1')).toBe(true);
      expect(timers.cleared).toBe(1);

      // Wrong session or missing event is not acknowledged.
      expect(application.acknowledgePendingNotification('message:msg-1:completed', 'other', 'client-1')).toBe(false);
      expect(application.acknowledgePendingNotification('missing', 'sess-1', 'client-1')).toBe(false);
    } finally {
      timers.restore();
    }
  });

  test('observer acks do not suppress the controller notification', () => {
    const timers = patchTimers();
    try {
      const application = makeApplication(state, makeDeps(state, {
        getControllerClientId: (sessionId) => (sessionId === 'sess-1' ? 'client-phone' : null),
      }));
      application.notifyTerminalMessage(makeMessage(), 'sess-1');

      expect(timers.timeouts).toHaveLength(1);
      expect(application.acknowledgePendingNotification('message:msg-1:completed', 'sess-1', 'client-desktop')).toBe(false);
      expect(timers.cleared).toBe(0);

      expect(application.acknowledgePendingNotification('message:msg-1:completed', 'sess-1', 'client-phone')).toBe(true);
      expect(timers.cleared).toBe(1);
    } finally {
      timers.restore();
    }
  });

  test('terminal notifications for ineligible sessions schedule nothing', () => {
    const timers = patchTimers();
    try {
      const application = createNotificationsApplication(makeDeps(state, {
        canNotifyForSession: () => false,
      }));
      application.notifyTerminalMessage(makeMessage(), 'sess-1');
      expect(timers.timeouts).toHaveLength(0);
    } finally {
      timers.restore();
    }
  });

  test('permission notifications dispatch only for still-pending asks in eligible sessions', async () => {
    const application = makeApplication(state);

    await application.dispatchPendingPermissionNotification('resolved-req', 'sess-1');
    expect(state.log.some((entry) => entry.startsWith('reserve:permission:'))).toBe(false);

    await application.dispatchPendingPermissionNotification('pending-req', 'sess-1');
    expect(state.log.some((entry) => entry.startsWith('reserve:permission:pending-req:'))).toBe(true);

    const ineligible = createNotificationsApplication(makeDeps(state, {
      canNotifyForSession: () => false,
    }));
    state.deliveries.clear();
    await ineligible.dispatchPendingPermissionNotification('pending-req', 'sess-1');
    expect(state.log.filter((entry) => entry.startsWith('reserve:permission:pending-req:')).length).toBe(1);
  });

  test('notifyPermissionRequired works when the method is destructured', async () => {
    const timers = patchTimers();
    try {
      const application = makeApplication(state);
      const { notifyPermissionRequired } = application;

      // Destructured invocation must not depend on `this`.
      notifyPermissionRequired('pending-req', 'sess-1');

      expect(timers.timeouts).toEqual([{ callback: expect.any(Function), delay: 3000 }]);
      timers.timeouts[0].callback();
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }

      expect(state.log.some((entry) => entry.startsWith('reserve:permission:pending-req:'))).toBe(true);
    } finally {
      timers.restore();
    }
  });

  test('runRetryTick re-dispatches due deliveries with the retry payload', async () => {
    state.deliveries.set('retry-1:sub-1', {
      event_id: 'retry-1',
      subscription_id: 'sub-1',
      event_type: 'session_completed',
      status: 'pending_retry',
      attempt_count: 1,
      created_at: 42,
      attempted_at: null,
      next_attempt_at: 1,
      delivered_at: null,
      error: null,
    });
    const application = makeApplication(state);

    await application.runRetryTick();

    expect(state.sent).toHaveLength(1);
    expect(JSON.parse(state.sent[0].payload)).toMatchObject({
      version: 1,
      eventId: 'retry-1',
      sessionId: '',
      createdAt: 42,
      route: '/server/srv-1/workspace/session/retry-1',
    });
    expect(state.log).toContain('delivered:retry-1:sub-1');
  });

  test('runRetryTick exhausts a throwing sender at the domain policy boundary', async () => {
    // attempt_count 4 means the next attempt would be the 6th (>= 5), which
    // is the domain's shouldExhaustRetries boundary; the delivery must be
    // marked exhausted without another reschedule.
    state.deliveries.set('retry-exhausted:sub-1', {
      event_id: 'retry-exhausted',
      subscription_id: 'sub-1',
      event_type: 'session_completed',
      status: 'pending_retry',
      attempt_count: 4,
      created_at: 42,
      attempted_at: null,
      next_attempt_at: 1,
      delivered_at: null,
      error: null,
    });
    state.sendResult = { success: true, statusCode: 201 };
    const application = createNotificationsApplication(makeDeps(state, {
      sender: {
        send: async () => {
          throw new Error('network exploded');
        },
        config: () => ({ available: true, vapidPublicKey: 'public' }),
      },
    }));

    await application.runRetryTick();

    expect(state.log).toContain('exhausted:retry-exhausted:sub-1');
    expect(state.log.some((entry) => entry.startsWith('retryable:retry-exhausted:'))).toBe(false);
  });

  test('cleanup delegates the 30-day cutoff', () => {
    const application = makeApplication(state);
    const now = 100_000;
    expect(application.cleanup(now)).toBe(1);
    expect(state.log).toEqual([`deleteAllOld:${now - 30 * 24 * 60 * 60 * 1000}`]);
  });
});
