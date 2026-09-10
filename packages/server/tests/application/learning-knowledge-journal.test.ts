import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createKnowledgeJournal } from '@/application/learning/knowledge-journal';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { initializeLearningSchema } from '@/infrastructure/sqlite/learning-schema';

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
  db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY)');
  db.run('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT)');
  db.run("INSERT INTO workspaces VALUES ('ws')");
  db.run("INSERT INTO sessions VALUES ('s')");
  db.run("INSERT INTO messages VALUES ('m', 's')");
  initializeLearningSchema(db);
});
afterEach(() => db.close());

function fixture() {
  const repository = createLearningRepository(db);
  repository.activate('ws', 'dev', 1000);
  repository.enqueue('ws', 'dev', 's', 'm', 1000);
  const run = repository.claim('ws', 'dev', 1000, 60_000)!;
  const files = new Map<string, string>();
  let authorized = true;
  let crash = false;
  let writes = 0;
  const journal = createKnowledgeJournal({
    repository, now: () => 1001,
    authorize: async () => { if (!authorized) throw new Error('Revoked'); },
    files: {
      read: async path => files.get(path) ?? null,
      compareAndSwap: async (path, expected, replacement) => {
        if ((files.get(path) ?? null) !== expected) return false;
        if (replacement === null) files.delete(path); else files.set(path, replacement);
        writes++;
        if (crash) throw new Error('Crash after file activation');
        return true;
      },
    },
  });
  const input = { runId: run.id, operationId: 'op', relativePath: 'memory/MEMORY.md', before: null, after: '- Verified\n' };
  return { repository, run, files, journal, input, writes: () => writes, revoke: () => { authorized = false; }, crash: () => { crash = true; } };
}

test('journals activation and makes retries idempotent', async () => {
  const f = fixture();
  expect(await f.journal.apply(f.input)).toBe('applied');
  expect(await f.journal.apply(f.input)).toBe('applied');
  expect(f.writes()).toBe(1);
  expect(f.repository.changes(f.run.id)[0]?.status).toBe('applied');
});

test('stale activation never overwrites a foreground edit', async () => {
  const f = fixture();
  f.files.set(f.input.relativePath, 'Foreground');
  expect(await f.journal.apply(f.input)).toBe('conflict');
  expect(f.files.get(f.input.relativePath)).toBe('Foreground');
  expect(f.writes()).toBe(0);
});

test('undo checks current content and refuses active runs', async () => {
  const f = fixture();
  await f.journal.apply(f.input);
  const change = f.repository.changes(f.run.id)[0]!;
  await expect(f.journal.undo(f.run.id, change.id)).rejects.toThrow('active');
  f.repository.finish(f.run.id, 1002, { success: true });
  f.files.set(f.input.relativePath, 'Later edit');
  expect(await f.journal.undo(f.run.id, change.id)).toBe('conflict');
  expect(f.repository.changes(f.run.id)[0]?.status).toBe('applied');
  f.files.set(f.input.relativePath, f.input.after);
  expect(await f.journal.undo(f.run.id, change.id)).toBe('undone');
  expect(f.files.has(f.input.relativePath)).toBe(false);
  expect(await f.journal.undo(f.run.id, change.id)).toBe('undone');
});

test('crash after activation is reconciled without replaying the write', async () => {
  const f = fixture();
  f.crash();
  await expect(f.journal.apply(f.input)).rejects.toThrow('Crash');
  const change = f.repository.changes(f.run.id)[0]!;
  expect(change.status).toBe('prepared');
  await expect(f.journal.reconcile(f.run.id, change.id)).rejects.toThrow('Stop');
  f.repository.recover(1002);
  expect(await f.journal.reconcile(f.run.id, change.id)).toBe('applied');
  expect(f.writes()).toBe(1);
});

test('recovery does not apply an unactivated prepared write', async () => {
  const f = fixture();
  const change = f.repository.prepareChange({ run_id: f.run.id, operation_id: 'op', relative_path: f.input.relativePath, before_content: null, after_content: f.input.after, created_at: 1001 });
  f.repository.recover(1002);
  expect(await f.journal.reconcile(f.run.id, change.id)).toBe('conflict');
  expect(f.writes()).toBe(0);
});

test('undo crash preserves intent and recovery recognizes restored bytes', async () => {
  const f = fixture();
  await f.journal.apply(f.input);
  f.repository.finish(f.run.id, 1002, { success: true });
  const change = f.repository.changes(f.run.id)[0]!;
  f.crash();
  await expect(f.journal.undo(f.run.id, change.id)).rejects.toThrow('Crash');
  expect(f.repository.hasUndoIntent(change.id)).toBe(true);
  expect(await f.journal.reconcile(f.run.id, change.id)).toBe('undone');
  expect(f.repository.hasUndoIntent(change.id)).toBe(false);
  expect(f.writes()).toBe(2);
});

test('undo intent blocks a new reviewer and ambiguous recovery never writes', async () => {
  const f = fixture();
  await f.journal.apply(f.input);
  f.repository.finish(f.run.id, 1002, { success: true });
  const change = f.repository.changes(f.run.id)[0]!;
  expect(f.repository.prepareUndo(change.id, 1003)).toBe(true);
  f.repository.activate('ws', 'other', 1003);
  f.repository.enqueue('ws', 'other', 's', 'm', 1003);
  expect(f.repository.claim('ws', 'other', 1004, 60_000)).toBeNull();
  f.files.set(f.input.relativePath, 'External edit');
  expect(await f.journal.reconcile(f.run.id, change.id)).toBe('conflict');
  expect(f.repository.hasUndoIntent(change.id)).toBe(true);
  expect(f.writes()).toBe(1);
});

test('revoked access and no-op changes never write', async () => {
  const f = fixture();
  expect(await f.journal.apply({ ...f.input, after: null })).toBe('unchanged');
  expect(f.repository.changes(f.run.id)).toHaveLength(0);
  f.revoke();
  await expect(f.journal.apply(f.input)).rejects.toThrow('Revoked');
  expect(f.writes()).toBe(0);
});
