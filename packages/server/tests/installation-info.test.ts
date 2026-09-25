import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createApp } from '@/transport/http/app';
import { getOrCreateInstallationId } from '@/infrastructure/runtime/installation-id';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';

beforeEach(() => { setupTestDataDir(); setupTestDatabase(); });
afterEach(() => { resetTestDatabase(); resetTestDataDir(); });

test('startup-supplied installation identity is additive on the public info contract', async () => {
  const id = getOrCreateInstallationId();
  const app = createApp(undefined, { clientAssetsRoot: null, installationId: id });
  const response = await app.request('/api/info');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: 'AI Agent Server', runtime: 'bun', installationId: id,
    features: { websocket: true, sessions: true },
  });
  const legacy = createApp(undefined, { clientAssetsRoot: null });
  expect(await (await legacy.request('/api/info')).json()).not.toHaveProperty('installationId');
});
