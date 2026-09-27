import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestSession } from '#tests/factories';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession, selectEmptySessionHarnessModel, updateSession } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';

beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws1' });
});
afterEach(resetTestDatabase);

function makeSession(id: string, harness: 'prokop' | 'codex-cli' = 'prokop') {
  const { createdAt: _created, updatedAt: _updated, ...session } = createTestSession({
    id, workspaceId: 'ws1', title: id, status: 'active',
  });
  return createSession({ ...session, harness });
}

const codex = { harness: 'codex-cli', modelId: 'codex-model', effort: 'high' } as const;
const prokop = { harness: 'prokop', modelId: 'prokop-model', providerId: 'provider' } as const;

test('switches a root session both ways, clearing the other harness selection', () => {
  makeSession('root');
  const initial = updateSession('root', { preconfigId: 'agent', agentId: 'agent' })!;
  const selected = selectEmptySessionHarnessModel('root', 'prokop', initial.updatedAt, codex);
  expect(selected).toMatchObject({ harness: 'codex-cli', selectedModel: codex.modelId,
    preconfigId: initial.preconfigId, agentId: initial.agentId });
  expect(getDatabase().query('SELECT model, effort FROM codex_session_models WHERE session_id = ?').get('root'))
    .toEqual({ model: codex.modelId, effort: codex.effort });
  const returned = selectEmptySessionHarnessModel('root', 'codex-cli', selected!.updatedAt, prokop);
  expect(returned).toMatchObject({ harness: 'prokop', selectedProvider: 'provider', selectedModel: 'prokop-model' });
  expect(getDatabase().query('SELECT model FROM codex_session_models WHERE session_id = ?').get('root')).toBeNull();
});

test('rejects stale selections, messages, queued work, and native Codex bindings', () => {
  const first = makeSession('stale');
  expect(selectEmptySessionHarnessModel(first.id, 'prokop', 'older', codex)).toBeNull();
  expect(selectEmptySessionHarnessModel(first.id, 'codex-cli', first.updatedAt, prokop)).toBeNull();

  const message = makeSession('message');
  getDatabase().run(`INSERT INTO messages (id, session_id, role, created_at) VALUES ('m', ?, 'user', 1)`, [message.id]);
  expect(selectEmptySessionHarnessModel(message.id, 'prokop', message.updatedAt, codex)).toBeNull();

  const queued = makeSession('queued');
  getDatabase().run(`INSERT INTO queued_messages (id, session_id, content, position, created_at)
    VALUES ('q', ?, 'hello', 1, 1)`, [queued.id]);
  expect(selectEmptySessionHarnessModel(queued.id, 'prokop', queued.updatedAt, codex)).toBeNull();

  const bound = makeSession('bound', 'codex-cli');
  getDatabase().run(`INSERT INTO codex_session_bindings (session_id, thread_id, cli_version, workspace_root, created_at)
    VALUES (?, 'thread', '0.156.1', '/tmp', 'now')`, [bound.id]);
  expect(selectEmptySessionHarnessModel(bound.id, 'codex-cli', bound.updatedAt, prokop)).toBeNull();
  expect(getSession(bound.id)?.harness).toBe('codex-cli');
});

test('rejects child, closed, and running sessions', () => {
  makeSession('parent');
  const child = createSession({ ...createTestSession({ id: 'child', workspaceId: 'ws1', title: 'child', status: 'active' }), parentId: 'parent' });
  expect(selectEmptySessionHarnessModel(child.id, 'prokop', child.updatedAt, codex)).toBeNull();
  const closed = makeSession('closed');
  getDatabase().run("UPDATE sessions SET status = 'closed' WHERE id = ?", [closed.id]);
  expect(selectEmptySessionHarnessModel(closed.id, 'prokop', closed.updatedAt, codex)).toBeNull();
  const running = makeSession('running');
  getDatabase().run("UPDATE sessions SET running_at = 'now' WHERE id = ?", [running.id]);
  expect(selectEmptySessionHarnessModel(running.id, 'prokop', running.updatedAt, codex)).toBeNull();
});
