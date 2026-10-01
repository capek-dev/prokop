import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createCodexModelCatalogCache, getCodexModelSelection, listCodexModels, saveCodexModelSelection } from '@/harnesses/codex-cli/models';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

function create(id: string, harness: 'codex-cli' | 'prokop' = 'codex-cli'): void {
  createSession({ id, workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness });
}

function fakeCatalog(pages: unknown[]): { connection: CodexConnection; requests: Record<string, unknown>[] } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const requests: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const connection: CodexConnection = {
    stdout: new ReadableStream({ start(c) { controller = c; } }),
    stdin: { write(bytes) {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      requests.push(request);
      if ('id' in request) queueMicrotask(() => {
        const result = request.method === 'model/list' ? pages.shift() : {};
        controller.enqueue(encoder.encode(`${JSON.stringify({ id: request.id, result })}\n`));
      });
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill: () => { try { controller.close(); } catch { /* Closed. */ } },
  };
  return { connection, requests };
}

const model = (model: string) => ({ model, displayName: model, hidden: false,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
    { reasoningEffort: 'low' }, { reasoningEffort: 'medium' },
  ], isDefault: model === 'codex-one' });

test('Codex catalog pages retain model and effort values, not Prokop provider IDs', async () => {
  const fake = fakeCatalog([
    { data: [model('codex-one')], nextCursor: 'next' },
    { data: [model('codex-two')], nextCursor: null },
  ]);
  expect(await listCodexModels({ connect: () => fake.connection, version: () => 'codex-cli 0.156.1' }))
    .toEqual([
      { model: 'codex-one', name: 'codex-one', supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: true },
      { model: 'codex-two', name: 'codex-two', supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: false },
    ]);
  expect(fake.requests.filter(request => request.method === 'model/list').map(request => request.params))
    .toEqual([{ limit: 100 }, { limit: 100, cursor: 'next' }]);
});

test('malformed Codex catalog fails closed', async () => {
  const fake = fakeCatalog([{ data: [{ ...model('codex-one'), supportedReasoningEfforts: [{}] }], nextCursor: null }]);
  await expect(listCodexModels({ connect: () => fake.connection, version: () => 'codex-cli 0.156.1' }))
    .rejects.toThrow('Invalid Codex reasoning effort');
});

test('catalog cache shares one spawn across concurrent callers and expires by TTL', async () => {
  let spawns = 0;
  const fakeList = async (): ReturnType<typeof listCodexModels> => {
    spawns++;
    const fake = fakeCatalog([{ data: [model('codex-one')], nextCursor: null }]);
    return listCodexModels({ connect: () => fake.connection, version: () => 'codex-cli 0.156.1' });
  };
  const cached = createCodexModelCatalogCache(fakeList, 60_000);
  const [a, b] = await Promise.all([cached(), cached()]);
  expect(a).toBe(b);
  expect(spawns).toBe(1);

  const expired = createCodexModelCatalogCache(fakeList, -1);
  await expired();
  await expired();
  expect(spawns).toBe(3);
});

test('a failed Codex spawn clears the cache so the next caller retries', async () => {
  let fail = true;
  const fakeList = async (): ReturnType<typeof listCodexModels> => {
    if (fail) throw new Error('spawn down');
    const fake = fakeCatalog([{ data: [model('codex-one')], nextCursor: null }]);
    return listCodexModels({ connect: () => fake.connection, version: () => 'codex-cli 0.156.1' });
  };
  const cached = createCodexModelCatalogCache(fakeList, 60_000);
  await expect(cached()).rejects.toThrow('spawn down');
  fail = false;
  await expect(cached()).resolves.toBeDefined();
});

test('model preferences persist before binding a thread and never attach to Prokop sessions', () => {
  create('codex');
  create('prokop', 'prokop');
  expect(getCodexModelSelection('codex')).toBeNull();
  saveCodexModelSelection('codex', { model: 'codex-one', effort: 'low' });
  expect(getCodexModelSelection('codex')).toEqual({ model: 'codex-one', effort: 'low' });
  saveCodexModelSelection('codex', { model: 'codex-two', effort: 'medium' });
  expect(getCodexModelSelection('codex')).toEqual({ model: 'codex-two', effort: 'medium' });
  expect(() => saveCodexModelSelection('prokop', { model: 'codex-one', effort: 'low' })).toThrow();
});
