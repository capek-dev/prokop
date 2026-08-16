import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { registerNotificationRoutes } from '@/routes/notifications';
import { HttpError } from '@/utils/http-errors';
import type { NotificationsApplication } from '@/application/notifications';
import type { PushSubscriptionRecord } from '@jean2/sdk';

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

function makeFakeApplication(overrides: Partial<NotificationsApplication> = {}): NotificationsApplication {
  return {
    getConfig: () => ({ available: true, vapidPublicKey: 'public', permissionTimeoutMs: 1_800_000 }),
    upsertSubscription: () => makeRecord(),
    updatePreferences: () => makeRecord({ preferences: { completion: false, permission: true } }),
    deleteSubscription: () => {},
    dispatch: async () => {},
    notifyTerminalMessage: () => {},
    acknowledgePendingNotification: () => false,
    dispatchPendingPermissionNotification: async () => {},
    notifyPermissionRequired: () => {},
    runRetryTick: async () => {},
    cleanup: () => 0,
    ...overrides,
  };
}

function makeApp(application: NotificationsApplication): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: err.code, message: err.message };
      if (err.details !== undefined) {
        body.details = err.details;
      }
      return c.json(body, err.status as never);
    }
    return c.json({ error: 'Internal Server Error', message: String(err) }, 500 as never);
  });
  registerNotificationRoutes(app, application);
  return app;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

const validBody = {
  clientId: 'client-1',
  clientServerId: 'srv-1',
  clientOrigin: 'https://app.example.com',
  subscription: {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    expirationTime: null,
    keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
  },
  preferences: { completion: true, permission: true },
};

describe('notification route contract', () => {
  test('GET config returns the application config exactly', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/notifications/config');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      available: true,
      vapidPublicKey: 'public',
      permissionTimeoutMs: 1_800_000,
    });
  });

  test('PUT subscriptions maps the body to the application input and returns the record', async () => {
    const upserts: unknown[] = [];
    const app = makeApp(makeFakeApplication({
      upsertSubscription: (input) => {
        upserts.push(input);
        return makeRecord();
      },
    }));

    const res = await app.request('/api/notifications/subscriptions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(200);
    expect((await json(res)).subscription).toEqual(expect.objectContaining({ id: 'sub-1' }));
    expect(upserts).toEqual([{
      clientId: 'client-1',
      clientServerId: 'srv-1',
      clientOrigin: 'https://app.example.com',
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        expirationTime: null,
        keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
      },
      preferences: { completion: true, permission: true },
    }]);
  });

  test('PUT subscriptions maps the raw body through validation with 400', async () => {
    const res = await makeApp(makeFakeApplication()).request('/api/notifications/subscriptions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, subscription: { ...validBody.subscription, endpoint: 'http://insecure' } }),
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('bad_request');
  });

  test('PATCH preferences updates and maps the exact 404', async () => {
    const patches: Array<{ id: string; preferences: unknown }> = [];
    const app = makeApp(makeFakeApplication({
      updatePreferences: (id, preferences) => {
        patches.push({ id, preferences });
        return makeRecord();
      },
    }));

    const ok = await app.request('/api/notifications/subscriptions/sub-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { completion: false, permission: true } }),
    });
    expect(ok.status).toBe(200);
    expect(patches).toEqual([{ id: 'sub-1', preferences: { completion: false, permission: true } }]);

    const missing = await makeApp(makeFakeApplication({ updatePreferences: () => null }))
      .request('/api/notifications/subscriptions/nope', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { completion: false, permission: true } }),
      });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'not_found', message: 'Subscription not found' });
  });

  test('DELETE subscriptions is idempotent and returns success', async () => {
    const deletes: string[] = [];
    const app = makeApp(makeFakeApplication({
      deleteSubscription: (id) => {
        deletes.push(id);
      },
    }));

    const res = await app.request('/api/notifications/subscriptions/sub-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ success: true });
    expect(deletes).toEqual(['sub-1']);
  });
});
