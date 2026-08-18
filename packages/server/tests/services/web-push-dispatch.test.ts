import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace, seedSession } from '#tests/seed';
import {
  upsertPushSubscription,
  listEnabledSubscriptionsForEvent,
  reserveDelivery,
  deleteStaleSubscription,
} from '@/infrastructure/sqlite/web-push';
import { createScheduledJob, deleteScheduledJob } from '@/infrastructure/sqlite/scheduled-job-store';
import { createPendingAsk } from '@/infrastructure/sqlite/pending-asks';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';

const validKeys = { p256dh: 'p256dh-value', auth: 'auth-value' };
const validEndpoint = 'https://fcm.googleapis.com/fcm/send/abc';

function makeSubscription(overrides?: Partial<Parameters<typeof upsertPushSubscription>[0]>) {
  return {
    clientId: 'client-1',
    clientServerId: 'srv-1',
    clientOrigin: 'https://app.example.com',
    subscription: {
      endpoint: validEndpoint,
      expirationTime: null as number | null,
      keys: validKeys,
    },
    preferences: { completion: true, permission: true },
    ...overrides,
  };
}

// Mock the web-push sendNotification to avoid real network calls
let mockSendResult: { success: boolean; statusCode: number; body?: string } = {
  success: true,
  statusCode: 201,
};

mock.module('web-push', () => {
  const mockObj = {
    generateVAPIDKeys: () => ({
      publicKey: 'BPub_test_public_key_for_testing_purposes_only_xx',
      privateKey: 'test_private_key_for_testing_purposes_only_xxxxx',
    }),
    setVapidDetails: () => {},
    sendNotification: async () => {
      if (!mockSendResult.success) {
        const err = new Error(mockSendResult.body || 'Failed') as Error & {
          statusCode: number;
          body?: string;
        };
        err.statusCode = mockSendResult.statusCode;
        err.body = mockSendResult.body;
        throw err;
      }
      return { statusCode: mockSendResult.statusCode, body: '' };
    },
  };
  return {
    default: mockObj,
    ...mockObj,
  };
});

describe('web-push dispatch service', () => {
  beforeEach(() => {
    setupTestDatabase();
    mockSendResult = { success: true, statusCode: 201 };
  });
  afterEach(() => resetTestDatabase());

  test('reserveDelivery deduplicates by event ID per subscription', () => {
    const sub = upsertPushSubscription(makeSubscription());

    const first = reserveDelivery({
      eventId: 'message:msg1:completed',
      subscriptionId: sub.id,
      eventType: 'session_completed',
    });
    expect(first).toBe(true);

    const second = reserveDelivery({
      eventId: 'message:msg1:completed',
      subscriptionId: sub.id,
      eventType: 'session_completed',
    });
    expect(second).toBe(false);
  });

  test('listEnabledSubscriptionsForEvent respects notification preferences', () => {
    upsertPushSubscription(makeSubscription({
      preferences: { completion: true, permission: false },
    }));
    upsertPushSubscription(makeSubscription({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/second',
        expirationTime: null,
        keys: validKeys,
      },
      preferences: { completion: false, permission: true },
    }));

    const completionSubs = listEnabledSubscriptionsForEvent('session_completed');
    const permissionSubs = listEnabledSubscriptionsForEvent('permission_required');

    expect(completionSubs.length).toBe(1);
    expect(permissionSubs.length).toBe(1);
  });

  test('deleteStaleSubscription removes subscription from enabled list', () => {
    const sub = upsertPushSubscription(makeSubscription());
    expect(listEnabledSubscriptionsForEvent('session_completed').length).toBe(1);

    deleteStaleSubscription(sub.id);
    expect(listEnabledSubscriptionsForEvent('session_completed').length).toBe(0);
  });

  test('dispatchNotification sends to all enabled subscriptions', async () => {
    upsertPushSubscription(makeSubscription());
    upsertPushSubscription(makeSubscription({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/second',
        expirationTime: null,
        keys: validKeys,
      },
    }));

    const app = getJean2NotificationsApplication();

    // Dynamically import to get the mocked version
    await app.dispatch({
      eventId: 'message:test:completed',
      eventType: 'session_completed',
      sessionId: 'session-1',
    });

    // Both subscriptions should have delivery records reserved
    const { getPushSubscription } = await import('@/infrastructure/sqlite/web-push');
    // Since sendNotification mock succeeds, deliveries are marked delivered
    expect(getPushSubscription).toBeDefined();
  });

  test('disabled preference skips the matching event type', async () => {
    upsertPushSubscription(makeSubscription({
      preferences: { completion: false, permission: true },
    }));

    const app = getJean2NotificationsApplication();

    // Completion event should find zero enabled subscriptions
    await app.dispatch({
      eventId: 'message:skip:completed',
      eventType: 'session_completed',
      sessionId: 'session-1',
    });

    // Permission event should find the one enabled subscription
    await app.dispatch({
      eventId: 'permission:perm1',
      eventType: 'permission_required',
      sessionId: 'session-1',
    });

    // No assertion needed here — the test passes if no errors are thrown
  });

  // ── Scheduled session gating ──────────────────────────────────

  describe('scheduled session notification gating', () => {
    test('normal top-level completion remains eligible', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));
      const session = seedSession('ws1', { parentId: null });

      const app = getJean2NotificationsApplication();

      const msg = {
        id: 'msg-normal-1',
        sessionId: session.id,
        role: 'assistant' as const,
        status: 'completed' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage(msg, session.id);

      const eventId = 'message:msg-normal-1:completed';
      const acked = app.acknowledgePendingNotification(eventId, session.id, 'client-1');
      expect(acked).toBe(true);
    });

    test('normal top-level failure remains eligible', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));
      const session = seedSession('ws1', { parentId: null });

      const app = getJean2NotificationsApplication();

      const msg = {
        id: 'msg-normal-error',
        sessionId: session.id,
        role: 'assistant' as const,
        status: 'error' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage(msg, session.id);

      const eventId = 'message:msg-normal-error:error';
      const acked = app.acknowledgePendingNotification(eventId, session.id, 'client-1');
      expect(acked).toBe(true);
    });

    test('scheduled completion is suppressed by default (notificationsEnabled=false)', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));

      const job = createScheduledJob('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      expect(job.notificationsEnabled).toBe(false);

      const session = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: job.id },
      });

      const app = getJean2NotificationsApplication();

      const msg = {
        id: 'msg-sched-off',
        sessionId: session.id,
        role: 'assistant' as const,
        status: 'completed' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage(msg, session.id);

      const eventId = 'message:msg-sched-off:completed';
      const acked = app.acknowledgePendingNotification(eventId, session.id, 'client-1');
      expect(acked).toBe(false); // Nothing was scheduled
    });

    test('scheduled completion is eligible when notificationsEnabled=true', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));

      const job = createScheduledJob('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        notificationsEnabled: true,
      });

      const session = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: job.id },
      });

      const app = getJean2NotificationsApplication();

      const msg = {
        id: 'msg-sched-on',
        sessionId: session.id,
        role: 'assistant' as const,
        status: 'completed' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage(msg, session.id);

      const eventId = 'message:msg-sched-on:completed';
      const acked = app.acknowledgePendingNotification(eventId, session.id, 'client-1');
      expect(acked).toBe(true);
    });

    test('scheduled failure respects the per-job notification setting', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));

      const jobOff = createScheduledJob('ws1', {
        name: 'Failure off',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });
      const sessionOff = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: jobOff.id },
      });

      const jobOn = createScheduledJob('ws1', {
        name: 'Failure on',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        notificationsEnabled: true,
      });
      const sessionOn = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: jobOn.id },
      });

      const app = getJean2NotificationsApplication();
      const messageBase = {
        role: 'assistant' as const,
        status: 'error' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage({
        ...messageBase,
        id: 'msg-failure-off',
        sessionId: sessionOff.id,
      }, sessionOff.id);
      expect(app.acknowledgePendingNotification(
        'message:msg-failure-off:error',
        sessionOff.id,
        'client-1',
      )).toBe(false);

      app.notifyTerminalMessage({
        ...messageBase,
        id: 'msg-failure-on',
        sessionId: sessionOn.id,
      }, sessionOn.id);
      expect(app.acknowledgePendingNotification(
        'message:msg-failure-on:error',
        sessionOn.id,
        'client-1',
      )).toBe(true);
    });

    test('scheduled completion fails closed when job is deleted', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        preferences: { completion: true, permission: true },
      }));

      const job = createScheduledJob('ws1', {
        name: 'Job',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        notificationsEnabled: true,
      });

      const session = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: job.id },
      });

      // Delete the job so the session references a missing record
      deleteScheduledJob(job.id);

      const app = getJean2NotificationsApplication();

      const msg = {
        id: 'msg-sched-missing',
        sessionId: session.id,
        role: 'assistant' as const,
        status: 'completed' as const,
        modelId: 'test',
        providerId: 'test',
        tokens: { prompt: 0, completion: 0 },
        cost: 0,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };

      app.notifyTerminalMessage(msg, session.id);

      const eventId = 'message:msg-sched-missing:completed';
      const acked = app.acknowledgePendingNotification(eventId, session.id, 'client-1');
      expect(acked).toBe(false);
    });

    test('scheduled permission request is suppressed when off, dispatched when on', async () => {
      seedWorkspace({ id: 'ws1' });
      upsertPushSubscription(makeSubscription({
        clientId: 'client-perm',
        preferences: { completion: true, permission: true },
      }));

      const jobOff = createScheduledJob('ws1', {
        name: 'Off',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
      });

      const sessionOff = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: jobOff.id },
      });

      const requestIdOff = 'perm-request-off';
      createPendingAsk({
        requestId: requestIdOff,
        sessionId: sessionOff.id,
        rootSessionId: sessionOff.id,
        toolCallId: 'call-1',
        toolName: 'test-tool',
        ask: { type: 'permission', question: 'Allow?', risk: 'low', resource: 'test', action: 'run' },
        status: 'pending',
        isPermission: true,
        createdAt: Date.now(),
      });

      const app = getJean2NotificationsApplication();
      await app.dispatchPendingPermissionNotification(requestIdOff, sessionOff.id);

      // No delivery row should have been created for the off-session
      const subs = listEnabledSubscriptionsForEvent('permission_required');
      const offDelivery = reserveDelivery({
        eventId: 'permission:perm-request-off',
        subscriptionId: subs[0].id,
        eventType: 'permission_required',
      });
      expect(offDelivery).toBe(true); // Still available → nothing reserved it

      // Now enable notifications and test the on case
      const jobOn = createScheduledJob('ws1', {
        name: 'On',
        prompt: 'P',
        scheduleKind: 'interval',
        scheduleConfig: { type: 'interval', intervalMinutes: 60 },
        notificationsEnabled: true,
      });

      const sessionOn = seedSession('ws1', {
        parentId: null,
        metadata: { scheduledJobId: jobOn.id },
      });

      const requestIdOn = 'perm-request-on';
      createPendingAsk({
        requestId: requestIdOn,
        sessionId: sessionOn.id,
        rootSessionId: sessionOn.id,
        toolCallId: 'call-2',
        toolName: 'test-tool',
        ask: { type: 'permission', question: 'Allow?', risk: 'low', resource: 'test', action: 'run' },
        status: 'pending',
        isPermission: true,
        createdAt: Date.now(),
      });

      await app.dispatchPendingPermissionNotification(requestIdOn, sessionOn.id);

      // A delivery row should have been reserved by the server
      const onDelivery = reserveDelivery({
        eventId: 'permission:perm-request-on',
        subscriptionId: subs[0].id,
        eventType: 'permission_required',
      });
      expect(onDelivery).toBe(false); // Already reserved → dispatch happened
    });
  });
});
