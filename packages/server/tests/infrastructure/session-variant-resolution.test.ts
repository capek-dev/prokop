import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'bun:sqlite';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { clearModelsCache } from '@/config';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import type { Session } from '@prokopai/sdk';

/**
 * Read-time variant resolution: the "default" (null) variant state is gone,
 * so every session on a variant-bearing model always carries a concrete
 * variant — the stored one when valid, otherwise the model's first (lowest)
 * key. Hermetic via a MODELS_PATH fixture.
 */

const CATALOG = {
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'v4-pro', name: 'V4 Pro', contextWindow: 1000, variants: { high: { providerOptions: {} }, max: { providerOptions: {} } } },
        { id: 'flash', name: 'Flash', contextWindow: 1000, variants: { high: { providerOptions: {} }, max: { providerOptions: {} } } },
        { id: 'plain', name: 'Plain', contextWindow: 1000 },
      ],
    },
  ],
  defaultModel: 'flash',
  defaultProvider: 'deepseek',
  defaultVariant: 'max',
};

let db: Database;
let fixtureDir: string;
const savedPaths: Record<string, string | undefined> = {};

beforeEach(() => {
  db = setupTestDatabase();
  db.run("INSERT INTO workspaces (id, name, path, created_at, updated_at) VALUES ('ws', 'WS', '/tmp', 0, 0)");
  fixtureDir = mkdtempSync(join(tmpdir(), 'variant-catalog-'));
  writeFileSync(join(fixtureDir, 'models.json'), JSON.stringify(CATALOG));
  for (const key of ['PROKOPAI_MODELS_PATH', 'JEAN2_MODELS_PATH', 'MODELS_PATH']) {
    savedPaths[key] = process.env[key];
    process.env[key] = join(fixtureDir, 'models.json');
  }
  clearModelsCache();
});

afterEach(() => {
  resetTestDatabase();
  db.close();
  for (const [key, value] of Object.entries(savedPaths)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearModelsCache();
  rmSync(fixtureDir, { recursive: true, force: true });
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    workspaceId: 'ws',
    preconfigId: null,
    title: 'T',
    status: 'active',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    selectedModel: null,
    selectedProvider: null,
    selectedVariant: null,
    parentId: null,
    agentName: null,
    subagentStatus: null,
    runningAt: null,
    compacting: false,
    tags: [],
    permissionMode: 'standard',
    agentId: null,
    ...overrides,
  } as Session;
}

test('a valid stored variant survives the read', () => {
  const created = createSession(makeSession({ selectedModel: 'v4-pro', selectedProvider: 'deepseek', selectedVariant: 'max' }));
  expect(getSession(created.id)?.selectedVariant).toBe('max');
});

test('a null stored variant resolves to the model first (lowest) variant', () => {
  const created = createSession(makeSession({ selectedModel: 'v4-pro', selectedProvider: 'deepseek' }));
  expect(getSession(created.id)?.selectedVariant).toBe('high');
});

test('a stale stored variant (model changed underneath) resolves to the first variant', () => {
  const created = createSession(makeSession({ selectedModel: 'v4-pro', selectedProvider: 'deepseek', selectedVariant: 'max' }));
  db.run('UPDATE sessions SET selected_model = ?, selected_variant = ? WHERE id = ?', ['flash', 'xhigh', created.id]);
  expect(getSession(created.id)?.selectedVariant).toBe('high');
});

test('models without variants read back null; fresh sessions follow the configured default variant', () => {
  const plain = createSession(makeSession({ selectedModel: 'plain', selectedProvider: 'deepseek' }));
  expect(getSession(plain.id)?.selectedVariant).toBeNull();

  // Configured defaultVariant wins for the default model.
  const fresh = createSession(makeSession({}));
  const read = getSession(fresh.id);
  expect(read?.selectedModel).toBeNull();
  expect(read?.selectedVariant).toBe('max');

  // Without one, the default model's first (lowest) variant applies.
  writeFileSync(join(fixtureDir, 'models.json'), JSON.stringify({ ...CATALOG, defaultVariant: null }));
  clearModelsCache();
  const fallback = createSession(makeSession({}));
  expect(getSession(fallback.id)?.selectedVariant).toBe('high');
});
