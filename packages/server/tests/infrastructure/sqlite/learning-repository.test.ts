import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { initializeLearningSchema } from '@/infrastructure/sqlite/learning-schema';
import { createLearningRepository, type LearningRepository } from '@/infrastructure/sqlite/learning-repository';

let db: Database;
let store: LearningRepository;
const now = 10 * 86_400_000;

beforeEach(() => {
  db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
  db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE)');
  db.run('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE)');
  db.run("INSERT INTO workspaces VALUES ('ws'), ('other')");
  db.run("INSERT INTO sessions VALUES ('session', 'ws'), ('second', 'other')");
  db.run("INSERT INTO messages VALUES ('z', 'session'), ('a', 'session'), ('new', 'session'), ('foreign', 'second')");
  initializeLearningSchema(db);
  store = createLearningRepository(db);
  store.activate('ws', 'dev', now);
});
afterEach(() => db.close());

function enqueue(id = 'z', reviewer = 'dev'): void {
  expect(store.enqueue('ws', reviewer, 'session', id, now)).toBe(true);
}
function claim() {
  enqueue();
  return store.claim('ws', 'dev', now, 60_000)!;
}

describe('learning persistence', () => {
  test('migration is additive and repeatable; activation retains original backfill window', () => {
    initializeLearningSchema(db);
    expect(store.activate('ws', 'dev', now + 86_400_000)).toMatchObject({ activated_at: now, backfill_from: now - 7 * 86_400_000 });
    expect(store.enqueue('ws', 'dev', 'session', 'z', now - 7 * 86_400_000 - 1)).toBe(false);
    expect(store.enqueue('ws', 'dev', 'session', 'z', now - 7 * 86_400_000)).toBe(true);
  });

  test('stable insertion ordering, deduplication, and exact run snapshot', () => {
    enqueue('z');
    enqueue('a');
    expect(store.enqueue('ws', 'dev', 'session', 'z', now)).toBe(false);
    const run = store.claim('ws', 'dev', now, 60_000, 1)!;
    enqueue('new');
    expect(store.evidence(run.id).map(item => item.message_id)).toEqual(['z']);
    expect(store.finish(run.id, now + 1, { success: true })).toBe(true);
    expect(store.pending('ws', 'dev').map(item => item.message_id)).toEqual(['a', 'new']);
    expect(store.finish(run.id, now + 2, { success: true })).toBe(false);
  });

  test('filters before the limit across pages and supports repeated partial reads', () => {
    for (let i = 0; i < 205; i++) {
      db.run('INSERT INTO messages VALUES (?, ?)', [`page-${i}`, 'session']);
      store.enqueue('ws', 'dev', 'session', `page-${i}`, now);
    }
    const eligible = (id: string) => Number(id.slice(5)) >= 200;
    expect(store.pending('ws', 'dev', 1, eligible).map(item => item.message_id)).toEqual(['page-200']);
    expect(store.pending('ws', 'dev', 2, eligible).map(item => item.message_id)).toEqual(['page-200', 'page-201']);
    const run = store.claim('ws', 'dev', now, 60_000, 2, eligible)!;
    expect(store.evidence(run.id).map(item => item.message_id)).toEqual(['page-200', 'page-201']);
    expect(store.finish(run.id, now + 1, { success: true })).toBe(true);
    expect(store.pending('ws', 'dev', 1, eligible).map(item => item.message_id)).toEqual(['page-202']);
  });

  test('reviewers have independent evidence but serialize writes to the shared destination', () => {
    store.activate('ws', 'tester', now);
    enqueue('z', 'dev');
    enqueue('z', 'tester');
    const run = store.claim('ws', 'dev', now, 60_000)!;
    expect(store.claim('ws', 'tester', now, 60_000)).toBeNull();
    store.finish(run.id, now + 1, { success: true });
    expect(store.pending('ws', 'tester')).toHaveLength(1);
    expect(store.claim('ws', 'tester', now + 2, 60_000)).not.toBeNull();
  });

  test('failed runs do not consume evidence and successful no-ops do', () => {
    const run = claim();
    expect(store.finish(run.id, now + 1, { success: false, error: 'Unavailable model' })).toBe(true);
    expect(store.pending('ws', 'dev')).toHaveLength(1);
    const next = store.claim('ws', 'dev', now + 2, 60_000)!;
    expect(store.finish(next.id, now + 3, { success: true })).toBe(true);
    expect(store.pending('ws', 'dev')).toHaveLength(0);
  });

  test('expiry cannot allow overlapping writers; recovery fences old run completion', () => {
    const run = claim();
    expect(store.heartbeat(run.id, now + 60_000, 60_000)).toBe(false);
    expect(store.claim('ws', 'dev', now + 60_001, 60_000)).toBeNull();
    const reopened = createLearningRepository(db);
    expect(reopened.recover(now + 60_001)).toBe(1);
    expect(store.finish(run.id, now + 60_002, { success: true })).toBe(false);
    expect(reopened.pending('ws', 'dev')).toHaveLength(1);
    expect(reopened.claim('ws', 'dev', now + 60_002, 60_000)).not.toBeNull();
  });

  test.each(['failed', 'interrupted'] as const)('partial writes in %s runs block automatic evidence replay', status => {
    const run = claim();
    const change = store.prepareChange({ run_id: run.id, operation_id: 'partial', relative_path: 'memory/MEMORY.md', before_content: null, after_content: 'Lesson', created_at: now });
    store.transitionChange(change.id, 'prepared', 'applied');
    if (status === 'failed') store.finish(run.id, now + 1, { success: false, error: 'Later operation failed' });
    else store.recover(now + 1);
    expect(store.pending('ws', 'dev')).toHaveLength(1);
    expect(store.blocked('ws')).toBe(true);
    expect(store.claim('ws', 'dev', now + 2, 60_000)).toBeNull();
    expect(store.prepareUndo(change.id, now + 3)).toBe(true);
    expect(store.finishUndo(change.id, true)).toBe(true);
    expect(store.blocked('ws')).toBe(false);
  });

  test('destination binding survives reopen and cannot be redirected', () => {
    const run = claim();
    const binding = { run_id: run.id, workspace_path: '/workspace', memory_directory: '/workspace/.prokopai', skills_directory: '/workspace/.agents/skills' };
    store.bindDestination(binding);
    store.bindDestination(binding);
    expect(createLearningRepository(db).destination(run.id)).toEqual(binding);
    expect(() => store.bindDestination({ ...binding, memory_directory: '/other' })).toThrow('cannot change');
    expect(() => store.bindDestination({ ...binding, workspace_path: 'relative' })).toThrow('absolute paths');
    expect(store.activeRun('ws')?.id).toBe(run.id);
    store.finish(run.id, now + 1, { success: true });
    expect(store.activeRun('ws')).toBeNull();
    expect(() => store.bindDestination(binding)).toThrow('not active');
  });

  test('heartbeat extends the active lease', () => {
    const run = claim();
    expect(store.heartbeat(run.id, now + 30_000, 60_000)).toBe(true);
    expect(store.finish(run.id, now + 70_000, { success: true })).toBe(true);
  });

  test('wrong session-message association is rejected', () => {
    expect(store.enqueue('ws', 'dev', 'session', 'foreign', now)).toBe(false);
    expect(store.enqueue('ws', 'dev', 'session', 'missing', now)).toBe(false);
  });

  test('source deletion cascades evidence and destination deletion cascades history', () => {
    const run = claim();
    db.run("DELETE FROM messages WHERE id = 'z'");
    expect(store.evidence(run.id)).toEqual([]);
    db.run("DELETE FROM workspaces WHERE id = 'ws'");
    expect(store.getReviewer('ws', 'dev')).toBeNull();
    expect(store.getRun(run.id)).toBeNull();
  });

  test('prepared mutations are idempotent and block completion and retries until reconciled', () => {
    const run = claim();
    const input = { run_id: run.id, operation_id: 'op', relative_path: 'MEMORY.md', before_content: null, after_content: '- Lesson\n', created_at: now + 1 };
    const change = store.prepareChange(input);
    expect(store.prepareChange(input).id).toBe(change.id);
    expect(() => store.prepareChange({ ...input, after_content: 'different' })).toThrow('reused');
    expect(store.finish(run.id, now + 2, { success: true })).toBe(false);
    store.recover(now + 3);
    expect(store.claim('ws', 'dev', now + 4, 60_000)).toBeNull();
    expect(store.transitionChange(change.id, 'prepared', 'applied')).toBe(true);
    expect(store.transitionChange(change.id, 'prepared', 'applied')).toBe(false);
    expect(store.claim('ws', 'dev', now + 5, 60_000)).toBeNull();
    expect(store.transitionChange(change.id, 'applied', 'undone')).toBe(true);
    expect(store.claim('ws', 'dev', now + 6, 60_000)).not.toBeNull();
  });

  test('rejects invalid bookkeeping input', () => {
    expect(() => store.activate('ws', 'x', NaN)).toThrow();
    expect(() => store.pending('ws', 'dev', 0)).toThrow();
    expect(() => store.claim('ws', 'dev', now, 0)).toThrow();
    const run = claim();
    expect(() => store.prepareChange({ run_id: run.id, operation_id: 'x', relative_path: '../code.ts', before_content: null, after_content: '', created_at: now })).toThrow();
    expect(store.transitionChange('missing', 'prepared', 'undone')).toBe(false);
  });
});
