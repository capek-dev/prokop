import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { Workspace } from '@prokopai/sdk';
import { createLearningService, type LearningServiceDependencies } from '@/application/learning/service';
import { notifyLearningActivity } from '@/application/learning/activity';
import { createLearningRepository } from '@/infrastructure/sqlite/learning-repository';
import { initializeLearningSchema } from '@/infrastructure/sqlite/learning-schema';
import { enableLearning } from '@/domains/learning/settings';

let stop: (() => Promise<void>) | undefined;
let db: Database;
afterEach(async () => { await stop?.(); stop = undefined; db?.close(); });

async function flush(): Promise<void> { for (let i = 0; i < 100; i++) await Promise.resolve(); }

function fixture(overrides: Partial<LearningServiceDependencies> = {}) {
  db = new Database(':memory:');
  db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY)');
  db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY)');
  db.run('CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT)');
  db.run("INSERT INTO workspaces VALUES ('ws')");
  db.run("INSERT INTO sessions VALUES ('s')");
  db.run("INSERT INTO messages VALUES ('m','s')");
  initializeLearningSchema(db);
  const repository = createLearningRepository(db);
  const now = 100_000_000;
  const workspace = { id: 'ws', settings: enableLearning({}, 'dev', 'reviewer') } as Workspace;
  const events: string[] = [];
  const service = createLearningService({
    repository, workspaces: () => [workspace], now: () => now,
    discover: async () => [{ messageId: 'm', sessionId: 's', completedAt: now - 4_000_000 }],
    activity: () => ({ lastActivityAt: now - 4_000_000, running: false }), eligible: () => true,
    recover: async () => { events.push('recover'); }, onError: error => { throw error; },
    run: async (workspaceId, reviewerId) => {
      events.push('run');
      const run = repository.claim(workspaceId, reviewerId, now, 60_000)!;
      repository.finish(run.id, now + 1, { success: true });
      return true;
    },
    ...overrides,
  });
  stop = service.stop;
  return { service, repository, workspace, events, now };
}

test('service recovers before startup, discovers evidence and runs a due batch without polling', async () => {
  const { service, repository, events } = fixture();
  await service.start();
  await flush();
  expect(events).toEqual(['recover', 'run']);
  expect(repository.pending('ws', 'reviewer')).toEqual([]);
  service.notifyActivity();
  await flush();
  expect(events).toEqual(['recover', 'run']);
});

test('concurrent start recovers once and stop during recovery prevents late startup', async () => {
  const recovery = Promise.withResolvers<void>();
  let recoveries = 0;
  const { service, events } = fixture({ recover: () => { recoveries++; return recovery.promise; } });
  const first = service.start();
  expect(service.start()).toBe(first);
  await flush();
  const stopped = service.stop();
  recovery.resolve();
  await Promise.all([first, stopped]);
  notifyLearningActivity();
  await flush();
  expect(recoveries).toBe(1);
  expect(events).toEqual([]);
  await service.start();
  await flush();
  expect(recoveries).toBe(2);
  expect(events).toEqual(['run']);
});

test('failed recovery can be retried without activating the coordinator', async () => {
  let attempts = 0;
  const { service, events } = fixture({ recover: async () => { if (++attempts === 1) throw new Error('Recovery failed'); } });
  await expect(service.start()).rejects.toThrow('Recovery failed');
  expect(events).toEqual([]);
  await service.start();
  await flush();
  expect(events).toEqual(['run']);
});

test.each(['settings', 'evidence'] as const)('activity cancels an active review after %s changes', async kind => {
  let eligible = true;
  let runSignal: AbortSignal | undefined;
  const fixtureState = fixture({
    eligible: () => eligible,
    run: async (workspaceId, reviewerId, signal) => {
      const run = fixtureState.repository.claim(workspaceId, reviewerId, fixtureState.now, 60_000)!;
      runSignal = signal;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      fixtureState.repository.finish(run.id, fixtureState.now + 1, { success: false, error: 'Cancelled' });
      return false;
    },
  });
  await fixtureState.service.start();
  await flush();
  expect(runSignal?.aborted).toBe(false);
  notifyLearningActivity();
  expect(runSignal?.aborted).toBe(false);
  if (kind === 'settings') fixtureState.workspace.settings.learning!.enabled = false;
  else eligible = false;
  notifyLearningActivity();
  expect(runSignal?.aborted).toBe(true);
  await flush();
  expect(fixtureState.repository.listRuns('ws')[0]?.status).toBe('failed');
});
