import { afterEach, expect, test } from 'bun:test';
import { createLearningRecovery } from '@/application/learning/recovery';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { createKnowledgeJournal } from '@/application/learning/knowledge-journal';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

afterEach(resetTestDatabase);
function fixture() {
  const db = setupTestDatabase();
  seedWorkspace({ id: 'ws' }); seedSession('ws', { id: 'source' });
  db.run("INSERT INTO messages (id, session_id, role, created_at, status, sequence) VALUES ('answer', 'source', 'assistant', ?, 'completed', 0)", [Date.now()]);
  const repository = createLearningRepository(db);
  const now = Date.now();
  repository.activate('ws', 'dev', now); repository.enqueue('ws', 'dev', 'source', 'answer', now);
  const run = repository.claim('ws', 'dev', now, 60_000)!;
  const change = repository.prepareChange({ run_id: run.id, operation_id: 'write', relative_path: 'memory/MEMORY.md', before_content: 'before', after_content: 'after', created_at: now });
  return { repository, run, change, db };
}

test.each(['before', 'after', 'foreground'])('interrupted undo (%s) retires intent without writing or consuming evidence', async content => {
  const { repository, run, change } = fixture();
  repository.transitionChange(change.id, 'prepared', 'applied');
  repository.finish(run.id, Date.now(), { success: false, error: 'interrupted' });
  repository.prepareUndo(change.id, Date.now());
  let writes = 0;
  const journal = createKnowledgeJournal({ repository, now: Date.now, authorize: async () => {},
    files: { read: async () => content, compareAndSwap: async () => { writes++; return true; } } });
  const recover = createLearningRecovery({ repository, now: Date.now, reconcile: (_workspace, id, changeId) => journal.reconcile(id, changeId), onError: () => {} });
  await recover('ws'); await recover('ws');
  expect(writes).toBe(0);
  expect(repository.hasUndoIntent(change.id)).toBe(false);
  expect(repository.changes(run.id)[0].status).toBe(content === 'before' ? 'undone' : content === 'after' ? 'applied' : 'conflict');
  expect(repository.pending('ws', 'dev')).toHaveLength(1);
  expect(repository.blocked('ws')).toBe(false);
  expect(repository.isResolved(run.id)).toBe(false);
  // Automatic recovery is not a permanent bypass for future in-flight undo.
  if (content === 'after') {
    expect(repository.prepareUndo(change.id, Date.now())).toBe(true);
    expect(repository.blocked('ws')).toBe(true);
    await recover('ws');
  }
  expect(repository.claim('ws', 'dev', Date.now(), 60_000)).not.toBeNull();
});

test('recovery refuses active writers, then retires inaccessible destinations without touching files', async () => {
  const { repository, run, change } = fixture();
  let reads = 0;
  const recover = createLearningRecovery({ repository, now: Date.now, reconcile: async () => { reads++; throw new Error('Destination moved'); }, onError: () => {} });
  await recover('ws');
  expect(reads).toBe(0);
  expect(() => repository.completeRecovery(run.id, Date.now())).toThrow('writer is active');
  repository.recover(Date.now());
  await recover('ws');
  expect(reads).toBe(1);
  expect(repository.changes(run.id)[0]).toMatchObject({ id: change.id, status: 'conflict' });
  expect(repository.pending('ws', 'dev')).toHaveLength(1);
  expect(repository.blocked('ws')).toBe(false);
});

test('recovery drains more than one page and preserves legacy user resolutions', async () => {
  const { repository, run, db } = fixture();
  repository.recover(Date.now()); repository.keepCurrent(run.id, Date.now());
  for (let i = 0; i < 205; i++) db.run("INSERT INTO learning_runs (id,workspace_id,reviewer_id,status,started_at,lease_until) VALUES (?, 'ws', 'dev', 'interrupted', 0, 1)", [`old-${i}`]);
  const recover = createLearningRecovery({ repository, now: Date.now, reconcile: async () => {}, onError: () => {} });
  await recover('ws');
  expect(repository.isRecovered('old-204')).toBe(true);
  expect(repository.recoveryCandidates('ws')).toEqual([]);
  expect(repository.isResolved(run.id)).toBe(true);
  expect(repository.isRecovered(run.id)).toBe(false);
  expect(repository.pending('ws', 'dev')).toEqual([]);
});
