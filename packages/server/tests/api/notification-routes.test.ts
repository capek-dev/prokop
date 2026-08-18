import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createApp } from '@/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { getPushSubscription } from '@/infrastructure/sqlite/web-push';
import { getVapidCredentials, resetVapidCache } from '@/services/web-push/credentials';
import { getWebPushCredentialsPath } from '@/paths';
import { existsSync } from 'fs';

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

describe('Notification routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.JEAN2_AUTH_TOKEN;
    setupTestDataDir();
    setupTestDatabase();
    app = createApp();
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
    resetVapidCache();
    delete process.env.JEAN2_AUTH_TOKEN;
  });

  describe('GET /api/notifications/config', () => {
    test('returns available config with VAPID public key', async () => {
      const res = await app.request('/api/notifications/config');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.available).toBe(true);
      expect(body.vapidPublicKey).toBeDefined();
      expect(typeof body.vapidPublicKey).toBe('string');
      const key = body.vapidPublicKey as string;
      expect(key.length).toBeGreaterThan(0);
      expect(body.permissionTimeoutMs).toBe(1800000);
    });

    test('generates and persists VAPID credentials on first call', async () => {
      await app.request('/api/notifications/config');

      const credsPath = getWebPushCredentialsPath();
      expect(existsSync(credsPath)).toBe(true);
    });

    test('reuses existing credentials on second call', async () => {
      const first = await json(await app.request('/api/notifications/config'));
      const second = await json(await app.request('/api/notifications/config'));

      expect(second.vapidPublicKey).toBe(first.vapidPublicKey);
    });
  });

  describe('PUT /api/notifications/subscriptions', () => {
    test('creates a subscription and returns opaque record', async () => {
      const res = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(200);
      const body = await json(res);
      const sub = body.subscription as Record<string, unknown>;
      expect(sub.id).toBeDefined();
      expect(sub).not.toHaveProperty('endpoint');
      expect(sub).not.toHaveProperty('p256dh');
      expect(sub).not.toHaveProperty('auth');
    });

    test('deduplicates by endpoint on repeated calls', async () => {
      const firstRes = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      const firstBody = await json(firstRes);

      const secondRes = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, clientId: 'client-2' }),
      });
      const secondBody = await json(secondRes);

      expect(
        (secondBody.subscription as Record<string, unknown>).id,
      ).toBe(
        (firstBody.subscription as Record<string, unknown>).id,
      );
    });

    test('rejects non-HTTPS endpoint with 400', async () => {
      const res = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          subscription: {
            ...validBody.subscription,
            endpoint: 'http://insecure.example.com/push',
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    test('rejects missing keys with 400', async () => {
      const res = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          subscription: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/xyz',
            expirationTime: null,
            keys: {},
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    test('rejects oversized fields with 400', async () => {
      const res = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validBody,
          subscription: {
            ...validBody.subscription,
            keys: {
              p256dh: 'x'.repeat(300),
              auth: 'auth-value',
            },
          },
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/notifications/subscriptions/:id', () => {
    test('updates preferences', async () => {
      const createRes = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      const createBody = await json(createRes);
      const id = (createBody.subscription as Record<string, unknown>).id as string;

      const patchRes = await app.request(`/api/notifications/subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: { completion: false, permission: true },
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchBody = await json(patchRes);
      const sub = patchBody.subscription as Record<string, unknown>;
      const prefs = sub.preferences as Record<string, boolean>;
      expect(prefs.completion).toBe(false);
      expect(prefs.permission).toBe(true);
    });

    test('returns 404 for unknown id', async () => {
      const res = await app.request('/api/notifications/subscriptions/nonexistent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: { completion: false, permission: false },
        }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/notifications/subscriptions/:id', () => {
    test('deletes a subscription', async () => {
      const createRes = await app.request('/api/notifications/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      const createBody = await json(createRes);
      const id = (createBody.subscription as Record<string, unknown>).id as string;

      const deleteRes = await app.request(`/api/notifications/subscriptions/${id}`, {
        method: 'DELETE',
      });
      expect(deleteRes.status).toBe(200);
      const deleteBody = await json(deleteRes);
      expect(deleteBody.success).toBe(true);

      expect(getPushSubscription(id)).toBeNull();
    });

    test('is idempotent: returns 200 even if not found', async () => {
      const res = await app.request('/api/notifications/subscriptions/nonexistent', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
    });
  });

  describe('credentials privacy', () => {
    test('GET config does not expose private key', async () => {
      const res = await app.request('/api/notifications/config');
      const body = await json(res);

      const bodyStr = JSON.stringify(body);
      const creds = getVapidCredentials();
      expect(bodyStr).not.toContain(creds.privateKey);
    });
  });
});
