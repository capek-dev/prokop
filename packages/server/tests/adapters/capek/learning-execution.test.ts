import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Preconfig } from '@prokopai/sdk';
import { createLearningExecution } from '@/adapters/capek/learning-execution';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { createLearningReviewRunner } from '@/application/learning/review-runner';
import { createLearningEvidenceReader } from '@/infrastructure/sqlite/learning-evidence';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';
import { enableLearning } from '@/domains/learning/settings';

let root: string | undefined;
afterEach(async () => { resetTestDatabase(); if (root) await rm(root, { recursive: true, force: true }); });

test.each([false, true])('runner integrates scoped history and rechecks supporting revocation (%s)', async revoke => {
  const db = setupTestDatabase();
  root = await mkdtemp(join(await realpath(tmpdir()), 'learning-integration-'));
  const settings = enableLearning({}, 'dev', 'reviewer');
  seedWorkspace({ id: 'ws', path: root, settings });
  seedSession('ws', { id: 'source' });
  const now = Date.now();
  db.run(`INSERT INTO messages (id,session_id,role,created_at,status,agent,completed_at,sequence)
    VALUES ('answer','source','assistant',?,'completed','dev',?,0)`, [now, now]);
  seedSession('ws', { id: 'support' });
  db.run(`INSERT INTO messages (id,session_id,role,created_at,status,agent,completed_at,sequence)
    VALUES ('support-answer','support','assistant',?,'completed','dev',?,0)`, [now - 1000, now - 1000]);
  const repository = createLearningRepository(db);
  repository.activate('ws', 'reviewer', now);
  repository.enqueue('ws', 'reviewer', 'source', 'answer', now);
  const evidence = createLearningEvidenceReader(db, { kind: 'workspace', workspaceId: 'ws' });
  let executions = 0;
  const execute = createLearningExecution({
    database: db, repository, workspace: getWorkspace,
    directories: async () => ({ memoryDirectory: join(root!, 'memory'), skillsDirectory: join(root!, 'skills') }),
    createSession: () => 'review-session',
    execute: async input => {
      executions++;
      expect(input.preconfig.model).toBe('model');
      expect(input.improveSkills).toBe(false);
      const history = await input.search({ action: 'list' });
      expect(JSON.stringify(history)).toContain('source');
      expect((await input.search({ action: 'read', sessionId: 'support' })).success).toBe(true);
      expect(repository.sources(repository.listRuns('ws')[0]!.id)).toContainEqual({ message_id: 'support-answer', session_id: 'support' });
      expect((await input.knowledge('agent_memory', { action: 'add', target: 'memory', content: 'Wrong scope' })).success).toBe(false);
      expect((await input.knowledge('memory', { action: 'add', target: 'memory', content: 'Verified integration lesson' })).success).toBe(true);
      if (revoke) db.run('UPDATE sessions SET metadata = ? WHERE id = ?', [JSON.stringify({ learning: { excluded: true, includeAutomated: false } }), 'support']);
      return {};
    },
  });
  const runner = createLearningReviewRunner({
    repository, workspace: getWorkspace,
    preconfig: async () => ({ id: 'dev', model: 'model', provider: 'provider', systemPrompt: 'Developer' } as Preconfig),
    modelAvailable: () => true, eligible: (_workspace, id) => evidence.eligible(id), execute, now: Date.now,
  });
  expect(await runner.run('ws', 'reviewer', new AbortController().signal)).toBe(!revoke);
  expect(executions).toBe(1);
  expect(repository.pending('ws', 'reviewer')).toHaveLength(revoke ? 1 : 0);
  const run = repository.listRuns('ws')[0]!;
  expect(run.status).toBe(revoke ? 'failed' : 'completed');
  expect(repository.blocked('ws')).toBe(revoke);
  expect(repository.changes(run.id)[0]).toMatchObject({ status: 'applied', before_content: null, after_content: '- Verified integration lesson' });
  expect(await readFile(join(root, 'memory/MEMORY.md'), 'utf8')).toBe('- Verified integration lesson');
});
