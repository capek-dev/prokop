import { afterEach, expect, test } from 'bun:test';
import type { Preconfig } from '@prokopai/sdk';
import { createLearningReviewRunner, type LearningReviewRunnerDependencies } from '@/application/learning/review-runner';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { getWorkspace, updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { enableLearning } from '@/domains/learning/settings';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

afterEach(resetTestDatabase);

function fixture(overrides: Partial<LearningReviewRunnerDependencies> = {}) {
  const db = setupTestDatabase();
  const settings = enableLearning({}, 'dev', 'reviewer');
  seedWorkspace({ id: 'ws', settings });
  seedSession('ws', { id: 'source' });
  const now = Date.now();
  db.run(`INSERT INTO messages (id,session_id,role,created_at,status,agent,completed_at,sequence)
    VALUES ('answer','source','assistant',?,'completed','dev',?,0)`, [now, now]);
  const repository = createLearningRepository(db);
  repository.activate('ws', 'reviewer', now);
  repository.enqueue('ws', 'reviewer', 'source', 'answer', now);
  const calls: Parameters<LearningReviewRunnerDependencies['execute']>[0][] = [];
  const preconfig = { id: 'dev', model: 'inherited', provider: 'provider', variant: 'normal', systemPrompt: 'Review' } as Preconfig;
  const runner = createLearningReviewRunner({
    repository, workspace: getWorkspace, preconfig: async () => preconfig,
    modelAvailable: () => true, eligible: () => true, now: Date.now,
    execute: async input => { calls.push(input); return {}; },
    ...overrides,
  });
  return { runner, repository, calls, settings, preconfig };
}

test('uses the current preconfig model and records a successful no-op', async () => {
  const { runner, repository, calls, preconfig } = fixture();
  preconfig.model = 'updated';
  expect(await runner.run('ws', 'reviewer', new AbortController().signal)).toBe(true);
  expect(calls[0]?.preconfig).toMatchObject({ model: 'updated', provider: 'provider', variant: 'normal' });
  expect(repository.pending('ws', 'reviewer')).toHaveLength(0);
});

test('model overrides preserve their explicit variant without changing the preconfig', async () => {
  const { runner, calls, settings, preconfig } = fixture();
  settings.learning!.reviewers[0]!.modelOverride = { providerId: 'other', modelId: 'override', variant: 'deep' };
  updateWorkspace('ws', { settings });
  expect(await runner.run('ws', 'reviewer', new AbortController().signal)).toBe(true);
  expect(calls[0]?.preconfig).toMatchObject({ provider: 'other', model: 'override', variant: 'deep' });
  expect(preconfig).toMatchObject({ provider: 'provider', model: 'inherited', variant: 'normal' });
});

test('unavailable models fail visibly without execution or checkpoint advancement', async () => {
  const { runner, repository, calls } = fixture({ modelAvailable: () => false });
  expect(await runner.run('ws', 'reviewer', new AbortController().signal)).toBe(false);
  expect(calls).toHaveLength(0);
  expect(repository.listRuns('ws')[0]).toMatchObject({ status: 'failed', error: 'Learning model is unavailable' });
  expect(repository.pending('ws', 'reviewer')).toHaveLength(1);
});

test('budget cancellation waits for execution cleanup before releasing the run', async () => {
  const cleanup = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const { runner, repository } = fixture({
    timeoutMs: 10,
    execute: async ({ signal }) => {
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      aborted.resolve();
      await cleanup.promise;
      return {};
    },
  });
  const running = runner.run('ws', 'reviewer', new AbortController().signal);
  await aborted.promise;
  expect(repository.listRuns('ws')[0]?.status).toBe('running');
  expect(repository.blocked('ws')).toBe(true);
  cleanup.resolve();
  expect(await running).toBe(false);
  expect(repository.listRuns('ws')[0]?.status).toBe('failed');
  expect(repository.pending('ws', 'reviewer')).toHaveLength(1);
});

test('an already cancelled request never claims evidence', async () => {
  const { runner, repository, calls } = fixture();
  expect(await runner.run('ws', 'reviewer', AbortSignal.abort())).toBe(false);
  expect(repository.listRuns('ws')).toHaveLength(0);
  expect(calls).toHaveLength(0);
});
