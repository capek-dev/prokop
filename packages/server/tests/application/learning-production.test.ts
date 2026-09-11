import { afterEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, mkdir, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Preconfig, LearningRunSummary, LearningRunDetail } from '@prokopai/sdk';
import { createWiredLearning } from '@/bootstrap/learning';
import type { LearningExecutionDependencies } from '@/adapters/capek/learning-execution';
import { createSessionSchema, updateSessionSchema } from '@/transport/http/routes/schemas';
import { registerLearningRoutes } from '@/transport/http/routes/learning';
import { getSession, updateSession, createSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { enableLearning } from '@/domains/learning/settings';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

let root: string | undefined;
let learning: ReturnType<typeof createWiredLearning> | undefined;
afterEach(async () => { await learning?.stop(); learning = undefined; resetTestDatabase(); if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

async function fixture(personal = false, execute?: LearningExecutionDependencies['execute']) {
  const db = setupTestDatabase();
  root = await mkdtemp(join(await realpath(tmpdir()), 'learning-production-'));
  const settings = enableLearning({}, 'dev', 'reviewer');
  settings.learning!.reviewers[0]!.cadence = { idleMinutes: 1, minimumIntervalMinutes: 1, maximumPendingMinutes: 1 };
  seedWorkspace({ id: 'ws', path: root, settings: personal ? {} : settings });
  if (personal) {
    await mkdir(join(root, 'home'));
    seedWorkspace({ id: 'dev-home', path: join(root, 'home'), settings: { ...settings, isAgentHome: true, agentId: 'dev' } });
  }
  seedSession('ws', { id: 'source', title: 'Fix retry handling' });
  const now = Date.now() - 120_000;
  db.run(`INSERT INTO messages (id,session_id,role,created_at,status,agent,completed_at,sequence) VALUES ('answer','source','assistant',?,'completed','dev',?,0)`, [now, now]);
  let reviewSession = '';
  let calls = 0;
  const wire = () => createWiredLearning({ getAgentDirectory: async () => personal ? root! : null, isAgentSync: () => false,
    getPreconfigOrAgent: async () => ({ id: 'dev', provider: 'test', model: 'fake', systemPrompt: 'Review' } as Preconfig) }, {
    modelAvailable: () => true,
    execute: async input => {
      calls++; reviewSession = input.sessionId;
      if (execute) return execute(input);
      expect(getSession(input.sessionId)?.metadata?.learningRunId).toBeTruthy();
      expect((await input.knowledge(personal ? 'agent_memory' : 'memory', { action: 'add', target: 'memory', content: 'Verified production lesson' })).success).toBe(true);
      return {};
    },
  });
  learning = wire();
  const app = new Hono();
  app.onError((error, c) => c.json({ error: error.message }, 400));
  registerLearningRoutes(app, learning.api);
  return { db, settings, app, wire, calls: () => calls, reviewSession: () => reviewSession };
}

test('personal home reference writes survive failure and support history undo without replay', async () => {
  await fixture(true, async input => {
    expect(input.home).toBeDefined();
    expect(input.prompt).toContain('home_files');
    expect((await input.home!({ action: 'read', path: 'examples/retry.ts' })).success).toBe(true);
    expect((await input.home!({ action: 'write', path: 'examples/retry.ts', content: '// reference only', revision: null })).success).toBe(true);
    throw new Error('Interrupted after home write');
  });
  await learning!.start();
  for (let i = 0; i < 200 && !learning!.repository.listRuns('dev-home')[0]?.finished_at; i++) await Bun.sleep(5);
  await learning!.stop();
  const run = learning!.repository.listRuns('dev-home')[0]!;
  expect(run.status).toBe('failed');
  expect(learning!.repository.isRecovered(run.id)).toBe(true);
  expect(learning!.repository.pending('dev-home', 'reviewer')).toHaveLength(1);
  expect(await readFile(join(root!, 'home/examples/retry.ts'), 'utf8')).toBe('// reference only');
  const detail = learning!.api.detail('dev-home', run.id);
  expect(detail.changes[0].path).toBe('home/examples/retry.ts');
  expect(await learning!.api.undo('dev-home', run.id, detail.changes[0].id)).toEqual({ result: 'undone' });
  expect(await Bun.file(join(root!, 'home/examples/retry.ts')).exists()).toBe(false);
});

async function waitForReview(workspaceId = 'ws') {
  for (let i = 0; i < 200; i++) {
    if (learning!.repository.listRuns(workspaceId)[0]?.status === 'completed') return;
    await Bun.sleep(5);
  }
  throw new Error(JSON.stringify(learning!.repository.listRuns(workspaceId)));
}

test('production startup discovers, creates protected session, writes knowledge, exposes history and undoes via HTTP', async () => {
  const f = await fixture();
  await learning!.start();
  await waitForReview();
  await learning!.stop();
  expect(f.calls()).toBe(1);
  expect(await readFile(join(root!, '.prokopai/MEMORY.md'), 'utf8')).toBe('- Verified production lesson');
  const runs = await (await f.app.request('/api/workspaces/ws/learning/runs')).json() as { runs: LearningRunSummary[] };
  expect(runs.runs[0].status).toBe('completed');
  const runId = runs.runs[0].id;
  const detail = await (await f.app.request(`/api/workspaces/ws/learning/runs/${runId}`)).json() as LearningRunDetail;
  expect(detail.sessionId).toBe(f.reviewSession());
  expect(learning!.repository.reviewSessionId('missing-run')).toBeNull();
  expect(detail.sources).toEqual([{ sessionId: 'source', messageId: 'answer', title: 'Fix retry handling' }]);
  updateSession('source', { title: 'Updated conversation title' });
  expect(learning!.api.detail('ws', runId).sources[0].title).toBe('Updated conversation title');
  updateSession('source', { metadata: { learning: { excluded: true, includeAutomated: false } } });
  expect(learning!.api.detail('ws', runId).sources).toEqual([]);
  expect(detail.changes[0].after).toBe('- Verified production lesson');
  const undo = await f.app.request(`/api/workspaces/ws/learning/runs/${runId}/changes/${detail.changes[0].id}/undo`, { method: 'POST' });
  expect(await undo.json()).toEqual({ result: 'undone' });
  expect(await Bun.file(join(root!, '.prokopai/MEMORY.md')).exists()).toBe(false);
  updateSession(f.reviewSession(), { metadata: null });
  f.db.run(`INSERT INTO messages (id,session_id,role,created_at,status,agent,completed_at,sequence) VALUES ('review-output',?,'assistant',?,'completed','dev',?,0)`, [f.reviewSession(), Date.now(), Date.now()]);
  expect(learning!.reader(getWorkspace('ws')!).eligible('review-output')).toBe(false);
  const parent = getSession(f.reviewSession())!;
  createSession({ ...parent, id: 'child-review', parentId: parent.id, metadata: null });
  updateSession('child-review', { parentId: null, metadata: null });
  expect(f.db.query('SELECT run_id FROM learning_session_origins WHERE session_id = ?').get('child-review')).not.toBeNull();
});

test('personal production review learns only from owning participation and writes the agent root', async () => {
  const f = await fixture(true);
  await learning!.start(); await waitForReview('dev-home'); await learning!.stop();
  expect(f.calls()).toBe(1);
  expect(await readFile(join(root!, 'MEMORY.md'), 'utf8')).toBe('- Verified production lesson');
  expect(await Bun.file(join(root!, 'home/.prokopai/MEMORY.md')).exists()).toBe(false);
  expect(learning!.api.list('dev-home').runs[0]?.status).toBe('completed');
});

test('client metadata cannot forge protected origin and preview includes reviewer instructions', async () => {
  const { app, settings } = await fixture();
  expect(createSessionSchema.safeParse({ metadata: { learningRunId: 'forged' } }).success).toBe(false);
  expect(updateSessionSchema.safeParse({ metadata: { learningRunId: null } }).success).toBe(false);
  const response = await app.request('/api/workspaces/ws/learning/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: settings.learning, reviewerId: 'reviewer' }) });
  expect(response.status).toBe(200);
  expect((await response.json() as { prompt: string }).prompt).toStartWith('Review\n\n');
  const preview = await learning!.api.preview('ws', { ...settings.learning!, improveSkills: true }, 'reviewer');
  expect(preview.prompt).not.toContain('skill_manage');
});

test('exclusion and malformed policy are enforced by HTTP before discovery', async () => {
  const { app } = await fixture();
  expect((await app.request('/api/sessions/source/learning', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"excluded":"yes"}' })).status).toBe(400);
  const response = await app.request('/api/sessions/source/learning', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ excluded: true, includeAutomated: false }) });
  expect(response.status).toBe(200);
  expect(learning!.reader(getWorkspace('ws')!).eligible('answer')).toBe(false);
  await learning!.start();
  await Bun.sleep(20);
  await learning!.stop();
  expect(learning!.repository.listRuns('ws')).toEqual([]);
});

test('personal cadence waits for running sessions with owning-agent message participation', async () => {
  const f = await fixture(true);
  f.settings.learning!.reviewers[0]!.cadence!.maximumPendingMinutes = 120;
  f.db.run('UPDATE workspaces SET settings = ? WHERE id = ?', [JSON.stringify({ ...f.settings, isAgentHome: true, agentId: 'dev' }), 'dev-home']);
  updateSession('source', { runningAt: new Date().toISOString() });
  await learning!.start(); await Bun.sleep(30); await learning!.stop();
  expect(f.calls()).toBe(0);
});

test('history is chronological while old interrupted runs recover outside the history limit', async () => {
  const { db } = await fixture();
  const repo = learning!.repository;
  repo.activate('ws', 'reviewer', Date.now()); repo.enqueue('ws', 'reviewer', 'source', 'answer', Date.now());
  const run = repo.claim('ws', 'reviewer', Date.now(), 60_000)!;
  repo.prepareChange({ run_id: run.id, operation_id: 'old', relative_path: 'memory/MEMORY.md', before_content: null, after_content: 'Pending', created_at: Date.now() });
  repo.recover(Date.now());
  // Seed later successful history without executing another writer over the conflict.
  for (let i = 0; i < 101; i++) db.run(`INSERT INTO learning_runs (id, workspace_id, reviewer_id, status, started_at, lease_until)
    VALUES (?, 'ws', 'reviewer', 'completed', ?, ?)`, [`recent-${i}`, Date.now() + i + 1, Date.now() + i + 1]);
  expect(learning!.api.list('ws').runs[0].id).toBe('recent-100');
  await learning!.start(); await learning!.stop();
  expect(repo.isRecovered(run.id)).toBe(true);
  expect(repo.blocked('ws')).toBe(false);
  expect(repo.pending('ws', 'reviewer')).toHaveLength(1);
});

test.each(['after', 'foreground', 'before'])('production startup reconciles prepared bytes (%s) without executing or overwriting', async content => {
  const f = await fixture();
  const repo = learning!.repository;
  const now = Date.now();
  repo.activate('ws', 'reviewer', now);
  repo.enqueue('ws', 'reviewer', 'source', 'answer', now);
  const run = repo.claim('ws', 'reviewer', now, 60_000)!;
  const memoryDirectory = join(root!, '.prokopai');
  repo.bindDestination({ run_id: run.id, workspace_path: root!, memory_directory: memoryDirectory, skills_directory: join(root!, '.agents/skills') });
  repo.prepareChange({ run_id: run.id, operation_id: 'crash', relative_path: 'memory/MEMORY.md', before_content: 'before', after_content: 'after', created_at: now });
  await mkdir(memoryDirectory);
  await writeFile(join(memoryDirectory, 'MEMORY.md'), content);

  await learning!.start();
  await learning!.stop();

  const response = await f.app.request(`/api/workspaces/ws/learning/runs/${run.id}`);
  expect(response.status).toBe(200);
  const detail = await response.json() as LearningRunDetail;
  expect(detail.run.status).toBe('interrupted');
  expect(detail.changes[0].status).toBe(content === 'after' ? 'applied' : 'conflict');
  expect(await readFile(join(memoryDirectory, 'MEMORY.md'), 'utf8')).toBe(content);
  expect(repo.blocked('ws')).toBe(false);
  expect(detail.run.recovered).toBe(true);
  expect(detail.run.resolved).toBe(false);
  expect(repo.pending('ws', 'reviewer')).toHaveLength(1);
  await learning!.start(); await learning!.stop();
  expect(repo.pending('ws', 'reviewer')).toHaveLength(1);
  expect(await readFile(join(memoryDirectory, 'MEMORY.md'), 'utf8')).toBe(content);
  expect(f.calls()).toBe(0);
});

test.each([false, true])('shutdown preserves partial lessons and restart continues automatically (personal=%s)', async personal => {
  const wrote = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  let attempts = 0;
  const f = await fixture(personal, async input => {
    const tool = personal ? 'agent_memory' : 'memory';
    if (++attempts === 1) {
      expect((await input.knowledge(tool, { action: 'add', target: 'memory', content: 'First saved lesson' })).success).toBe(true);
      wrote.resolve();
      await new Promise<void>(resolve => {
        if (input.signal.aborted) resolve();
        else input.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      aborted.resolve();
      await cleanup.promise;
      return {};
    }
    expect(input.prompt).toContain('First saved lesson');
    expect(input.systemPrompt).toContain('add only missing lessons');
    expect((await input.knowledge(tool, { action: 'add', target: 'memory', content: 'Remaining lesson' })).success).toBe(true);
    return {};
  });
  const workspaceId = personal ? 'dev-home' : 'ws';
  const path = join(root!, personal ? 'MEMORY.md' : '.prokopai/MEMORY.md');
  await learning!.start();
  await wrote.promise;
  const run = learning!.repository.activeRun(workspaceId)!;
  let stopped = false;
  const stop = learning!.stop().then(() => { stopped = true; });
  await aborted.promise;
  expect(stopped).toBe(false);
  expect(learning!.repository.activeRun(workspaceId)?.id).toBe(run.id);
  cleanup.resolve(); await stop;
  expect(learning!.repository.getRun(run.id)?.status).toBe('interrupted');
  expect(learning!.repository.isRecovered(run.id)).toBe(true);
  expect(learning!.repository.blocked(workspaceId)).toBe(false);
  expect(learning!.repository.pending(workspaceId, 'reviewer')).toHaveLength(1);
  expect(await readFile(path, 'utf8')).toBe('- First saved lesson');

  // Simulate the elapsed cooldown and a new production composition after update.
  f.db.run('UPDATE learning_reviewers SET last_started_at = ? WHERE workspace_id = ?', [Date.now() - 120_000, workspaceId]);
  learning = f.wire();
  await learning.start(); await waitForReview(workspaceId); await learning.stop();
  expect(await readFile(path, 'utf8')).toBe('- First saved lesson\n- Remaining lesson');
  expect(learning.repository.pending(workspaceId, 'reviewer')).toEqual([]);
  expect(attempts).toBe(2);
  await learning.start(); await Bun.sleep(20); await learning.stop();
  expect(attempts).toBe(2);
});

test('failed partial review recovers while running and still honors source exclusion on restart', async () => {
  const f = await fixture(false, async input => {
    await input.knowledge('memory', { action: 'add', target: 'memory', content: 'Saved before failure' });
    throw new Error('Provider disconnected');
  });
  await learning!.start();
  for (let i = 0; i < 200 && !learning!.repository.listRuns('ws')[0]?.finished_at; i++) await Bun.sleep(5);
  await learning!.stop();
  const run = learning!.repository.listRuns('ws')[0]!;
  expect(run.status).toBe('failed');
  expect(learning!.repository.isRecovered(run.id)).toBe(true);
  expect(learning!.repository.blocked('ws')).toBe(false);
  expect(learning!.repository.pending('ws', 'reviewer')).toHaveLength(1);
  updateSession('source', { metadata: { learning: { excluded: true, includeAutomated: false } } });
  f.db.run('UPDATE learning_reviewers SET last_started_at = 0');
  learning = f.wire();
  await learning.start(); await Bun.sleep(20); await learning.stop();
  expect(f.calls()).toBe(1);
  expect(await readFile(join(root!, '.prokopai/MEMORY.md'), 'utf8')).toBe('- Saved before failure');
});

test('startup recovers applied interrupted changes and leaves optional undo available', async () => {
  await fixture();
  const repo = learning!.repository;
  const now = Date.now();
  repo.activate('ws', 'reviewer', now); repo.enqueue('ws', 'reviewer', 'source', 'answer', now);
  const run = repo.claim('ws', 'reviewer', now, 60_000)!;
  const dir = join(root!, '.prokopai');
  repo.bindDestination({ run_id: run.id, workspace_path: root!, memory_directory: dir, skills_directory: join(root!, '.agents/skills') });
  const change = repo.prepareChange({ run_id: run.id, operation_id: 'written', relative_path: 'memory/MEMORY.md', before_content: 'before', after_content: 'saved', created_at: now });
  repo.transitionChange(change.id, 'prepared', 'applied');
  await mkdir(dir); await writeFile(join(dir, 'MEMORY.md'), 'saved');
  await learning!.start(); await learning!.stop();
  expect(repo.isRecovered(run.id)).toBe(true);
  expect(repo.blocked('ws')).toBe(false);
  expect(repo.pending('ws', 'reviewer')).toHaveLength(1);
  expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toBe('saved');
  expect(await learning!.api.undo('ws', run.id, change.id)).toEqual({ result: 'undone' });
  expect(await readFile(join(dir, 'MEMORY.md'), 'utf8')).toBe('before');
});

test('conflict resolution retains files, validates history revision and never replays the batch on restart', async () => {
  const { app } = await fixture();
  const repo = learning!.repository;
  repo.activate('ws', 'reviewer', Date.now()); repo.enqueue('ws', 'reviewer', 'source', 'answer', Date.now());
  const run = repo.claim('ws', 'reviewer', Date.now(), 60_000)!;
  repo.prepareChange({ run_id: run.id, operation_id: 'crashed', relative_path: 'memory/MEMORY.md', before_content: null, after_content: 'Never activated', created_at: Date.now() });
  repo.recover(Date.now());
  expect(repo.blocked('ws')).toBe(true);
  const detail = learning!.api.detail('ws', run.id);
  const request = (revision: string) => app.request(`/api/workspaces/ws/learning/runs/${run.id}/keep-current`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }) });
  expect((await request('0'.repeat(64))).status).toBe(400);
  expect((await request(detail.revision)).status).toBe(200);
  expect(repo.blocked('ws')).toBe(false);
  expect(repo.pending('ws', 'reviewer')).toEqual([]);
  await learning!.start(); await Bun.sleep(20); await learning!.stop();
  expect(repo.listRuns('ws')).toHaveLength(1);
  expect(await Bun.file(join(root!, '.prokopai/MEMORY.md')).exists()).toBe(false);
});
