import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLearningHistory } from '@/adapters/capek/learning-history';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { getWorkspace, updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

let root: string | undefined;
afterEach(async () => { resetTestDatabase(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

async function fixture(prepared = false) {
  const db = setupTestDatabase();
  root = await mkdtemp(join(await realpath(tmpdir()), 'learning-history-'));
  seedWorkspace({ id: 'ws', path: root });
  seedSession('ws', { id: 'source' });
  const now = Date.now();
  db.run(`INSERT INTO messages (id,session_id,role,created_at,status,sequence)
    VALUES ('answer','source','assistant',?,'completed',0)`, [now]);
  const repository = createLearningRepository(db);
  repository.activate('ws', 'reviewer', now);
  repository.enqueue('ws', 'reviewer', 'source', 'answer', now);
  const run = repository.claim('ws', 'reviewer', now, 60_000)!;
  const directories = { memoryDirectory: join(root, 'memory'), skillsDirectory: join(root, 'skills') };
  repository.bindDestination({ run_id: run.id, workspace_path: root, memory_directory: directories.memoryDirectory, skills_directory: directories.skillsDirectory });
  const change = repository.prepareChange({ run_id: run.id, operation_id: 'write', relative_path: 'memory/MEMORY.md', before_content: 'before', after_content: 'after', created_at: now });
  await mkdir(directories.memoryDirectory);
  await writeFile(join(directories.memoryDirectory, 'MEMORY.md'), 'after');
  if (!prepared) {
    repository.transitionChange(change.id, 'prepared', 'applied');
    repository.finish(run.id, now + 1, { success: true });
  } else repository.recover(now + 1);
  const history = createLearningHistory({ repository, workspace: getWorkspace, directories: async () => directories, now: Date.now });
  return { db, repository, run, change, history, directories, path: join(directories.memoryDirectory, 'MEMORY.md') };
}

test('undo uses recorded destination even when learning is disabled', async () => {
  const { history, run, change, path } = await fixture();
  expect(await history.undo('ws', run.id, change.id)).toBe('undone');
  expect(await readFile(path, 'utf8')).toBe('before');
});

test('stale undo preserves foreground content', async () => {
  const { history, run, change, path, repository } = await fixture();
  await writeFile(path, 'foreground');
  expect(await history.undo('ws', run.id, change.id)).toBe('conflict');
  expect(await readFile(path, 'utf8')).toBe('foreground');
  expect(repository.hasUndoIntent(change.id)).toBe(false);
});

test('recovery recognizes applied bytes without replaying a write', async () => {
  const { history, run, change, path, repository } = await fixture(true);
  expect(await history.reconcile('ws', run.id, change.id)).toBe('applied');
  expect(repository.changes(run.id)[0]?.status).toBe('applied');
  expect(await readFile(path, 'utf8')).toBe('after');
});

test('rejects cross-workspace IDs and changed workspace paths', async () => {
  const { history, run, change, path } = await fixture();
  await expect(history.undo('other', run.id, change.id)).rejects.toThrow('unavailable');
  updateWorkspace('ws', { path: join(root!, 'moved') });
  await expect(history.undo('ws', run.id, change.id)).rejects.toThrow('unavailable');
  expect(await readFile(path, 'utf8')).toBe('after');
});

test('rejects changed directory resolution and legacy runs without a destination', async () => {
  const { db, repository, directories, history, run, change, path } = await fixture();
  const redirected = createLearningHistory({ repository, workspace: getWorkspace, directories: async () => ({ ...directories, memoryDirectory: join(root!, 'other') }), now: Date.now });
  await expect(redirected.undo('ws', run.id, change.id)).rejects.toThrow('destination changed');
  db.run('DELETE FROM learning_destinations WHERE run_id = ?', [run.id]);
  await expect(history.undo('ws', run.id, change.id)).rejects.toThrow('not recorded');
  expect(await readFile(path, 'utf8')).toBe('after');
});
