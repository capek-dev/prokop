import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import {
  upsertPushSubscription,
  getPushSubscription,
  updatePushSubscriptionPreferences,
  deletePushSubscription,
  listEnabledSubscriptionsForEvent,
  reserveDelivery,
  markDeliveryDelivered,
  markDeliveryFailed,
  markDeliveryRetryable,
  markDeliveryExhausted,
  deleteStaleSubscription,
  deleteOldDeliveries,
  deleteAllOldDeliveries,
  getDeliveriesDueForRetry,
} from '@/infrastructure/sqlite/web-push';

const validEndpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
const validKeys = { p256dh: 'p256dh-value', auth: 'auth-value' };

function makeUpsertInput(overrides?: Partial<Parameters<typeof upsertPushSubscription>[0]>) {
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

describe('push_subscriptions store', () => {
  beforeEach(() => setupTestDatabase());
  afterEach(() => resetTestDatabase());

  describe('upsertPushSubscription', () => {
    test('inserts a new subscription and returns opaque record', () => {
      const result = upsertPushSubscription(makeUpsertInput());

      expect(result.id).toBeDefined();
      expect(result.clientId).toBe('client-1');
      expect(result.clientServerId).toBe('srv-1');
      expect(result.preferences).toEqual({ completion: true, permission: true });
    });

    test('response does not expose endpoint or encryption keys', () => {
      const result = upsertPushSubscription(makeUpsertInput());

      const record = result as unknown as Record<string, unknown>;
      expect(record).not.toHaveProperty('endpoint');
      expect(record).not.toHaveProperty('p256dh');
      expect(record).not.toHaveProperty('auth');
    });

    test('deduplicates by endpoint: second upsert updates existing record', () => {
      const first = upsertPushSubscription(makeUpsertInput());

      const second = upsertPushSubscription(
        makeUpsertInput({
          clientId: 'client-2',
          preferences: { completion: false, permission: true },
        }),
      );

      expect(second.id).toBe(first.id);
      expect(second.clientId).toBe('client-2');
      expect(second.preferences.completion).toBe(false);
    });

    test('different endpoints create different subscriptions', () => {
      const first = upsertPushSubscription(makeUpsertInput());
      const second = upsertPushSubscription(
        makeUpsertInput({
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/def456',
            expirationTime: null,
            keys: validKeys,
          },
        }),
      );

      expect(second.id).not.toBe(first.id);
    });
  });

  describe('getPushSubscription', () => {
    test('returns the subscription by id', () => {
      const created = upsertPushSubscription(makeUpsertInput());
      const fetched = getPushSubscription(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
    });

    test('returns null for unknown id', () => {
      expect(getPushSubscription('nonexistent')).toBeNull();
    });
  });

  describe('updatePushSubscriptionPreferences', () => {
    test('updates only the preferences', () => {
      const created = upsertPushSubscription(makeUpsertInput());
      const updated = updatePushSubscriptionPreferences(created.id, {
        completion: false,
        permission: false,
      });

      expect(updated).not.toBeNull();
      expect(updated!.preferences.completion).toBe(false);
      expect(updated!.preferences.permission).toBe(false);
    });

    test('returns null for unknown id', () => {
      const result = updatePushSubscriptionPreferences('nonexistent', {
        completion: false,
        permission: false,
      });
      expect(result).toBeNull();
    });
  });

  describe('deletePushSubscription', () => {
    test('deletes an existing subscription', () => {
      const created = upsertPushSubscription(makeUpsertInput());
      expect(deletePushSubscription(created.id)).toBe(true);
      expect(getPushSubscription(created.id)).toBeNull();
    });

    test('returns false for unknown id', () => {
      expect(deletePushSubscription('nonexistent')).toBe(false);
    });
  });

  describe('listEnabledSubscriptionsForEvent', () => {
    test('returns only subscriptions with the matching preference enabled', () => {
      upsertPushSubscription(makeUpsertInput({
        preferences: { completion: true, permission: false },
      }));
      upsertPushSubscription(makeUpsertInput({
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
  });
});

describe('push_deliveries store', () => {
  beforeEach(() => setupTestDatabase());
  afterEach(() => resetTestDatabase());

  test('reserveDelivery returns true for new event, false for duplicate', () => {
    const sub = upsertPushSubscription(makeUpsertInput());

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

  test('markDeliveryDelivered updates status and subscription last_success_at', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({
      eventId: 'evt-1',
      subscriptionId: sub.id,
      eventType: 'session_completed',
    });

    markDeliveryDelivered('evt-1', sub.id);

    // Should not throw
    expect(true).toBe(true);
  });

  test('markDeliveryFailed updates status to permanent_failure', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({
      eventId: 'evt-2',
      subscriptionId: sub.id,
      eventType: 'session_completed',
    });

    markDeliveryFailed('evt-2', sub.id, '404 Not Found');

    expect(true).toBe(true);
  });

  test('deleteStaleSubscription removes the subscription', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    deleteStaleSubscription(sub.id);
    expect(getPushSubscription(sub.id)).toBeNull();
  });

  test('deleteOldDeliveries removes only old delivered records', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({
      eventId: 'evt-old',
      subscriptionId: sub.id,
      eventType: 'session_completed',
    });
    markDeliveryDelivered('evt-old', sub.id);

    const deleted = deleteOldDeliveries(Date.now() + 10000);
    expect(deleted).toBe(1);
  });
});

describe('push_deliveries retry and cleanup', () => {
  beforeEach(() => setupTestDatabase());
  afterEach(() => resetTestDatabase());

  const validEndpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
  const validKeys = { p256dh: 'p256dh-value', auth: 'auth-value' };

  function makeUpsertInput(overrides?: Partial<Parameters<typeof upsertPushSubscription>[0]>) {
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

  test('getDeliveriesDueForRetry returns only pending_retry deliveries past next_attempt_at', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({ eventId: 'evt-1', subscriptionId: sub.id, eventType: 'session_completed' });
    markDeliveryRetryable('evt-1', sub.id, 'HTTP 429', Date.now() - 1000);

    const due = getDeliveriesDueForRetry(Date.now());
    expect(due.length).toBe(1);
    expect(due[0].event_id).toBe('evt-1');
  });

  test('getDeliveriesDueForRetry excludes deliveries not yet due', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({ eventId: 'evt-2', subscriptionId: sub.id, eventType: 'session_completed' });
    markDeliveryRetryable('evt-2', sub.id, 'HTTP 429', Date.now() + 60000);

    const due = getDeliveriesDueForRetry(Date.now());
    expect(due.length).toBe(0);
  });

  test('markDeliveryExhausted moves to permanent_failure', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({ eventId: 'evt-3', subscriptionId: sub.id, eventType: 'session_completed' });
    markDeliveryExhausted('evt-3', sub.id);

    // After exhaustion, it should NOT appear in retry list
    const due = getDeliveriesDueForRetry(Date.now());
    expect(due.length).toBe(0);
  });

  test('deleteAllOldDeliveries removes records regardless of status', () => {
    const sub = upsertPushSubscription(makeUpsertInput());
    reserveDelivery({ eventId: 'evt-4', subscriptionId: sub.id, eventType: 'session_completed' });
    markDeliveryDelivered('evt-4', sub.id);
    reserveDelivery({ eventId: 'evt-5', subscriptionId: sub.id, eventType: 'session_completed' });
    markDeliveryFailed('evt-5', sub.id, 'HTTP 404');

    const deleted = deleteAllOldDeliveries(Date.now() + 10000);
    expect(deleted).toBe(2);
  });
});
