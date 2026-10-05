import { expect, test } from 'bun:test';
import type { GitStatusMessage, GitStatusResponse } from '@prokopai/sdk';
import { createGitStatusFeed } from '@/application/files/git-status-feed';

type Snapshot = Omit<GitStatusResponse, 'revision'>;

/** Deterministic clock and timers; computes resolve only when the test says so. */
function harness(initial: Partial<Snapshot> = {}) {
  let time = 1_000;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const computes: Array<{ root: string; resolve(snapshot: Snapshot): void }> = [];
  const delivered: Array<{ to: string; message: GitStatusMessage }> = [];
  let snapshot: Snapshot = { availability: { available: true, root: '/repo' }, files: [], root: '/repo', ...initial };

  const feed = createGitStatusFeed<string>({
    resolveRoot: (workspaceId, rootQuery) => {
      if (workspaceId === 'missing') throw new Error('Workspace not found');
      return rootQuery ?? '/repo';
    },
    compute: (_workspaceId, root) => new Promise((resolve) => computes.push({ root, resolve })),
    deliver: (to, message) => delivered.push({ to, message }),
    collectMs: 250,
    minIntervalMs: 2_000,
    now: () => time,
    setTimer: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  });

  return {
    feed,
    delivered,
    computes,
    setSnapshot(next: Partial<Snapshot>) { snapshot = { ...snapshot, ...next }; },
    /** Moves time forward, firing due timers in order. */
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = Math.max(time, due[1].at);
        due[1].run();
      }
      time = end;
    },
    /** Resolves the oldest pending compute with the current snapshot. */
    async finish() {
      const pending = computes.shift();
      if (!pending) throw new Error('no pending compute');
      pending.resolve(snapshot);
      await Promise.resolve();
      await Promise.resolve();
    },
    pendingTimers: () => timers.size,
  };
}

const modified = (path: string) => ({ path, git: { status: 'modified' as const, staged: false, unstaged: true } });

test('a subscriber gets a snapshot immediately, then only changes', async () => {
  const h = harness();
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();
  expect(h.delivered.map(d => d.to)).toEqual(['c1']);
  expect(h.delivered[0]!.message).toMatchObject({ type: 'git.status', workspaceId: 'ws', root: '/repo' });

  // Unchanged status is computed but not pushed.
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.delivered).toHaveLength(1);

  h.setSnapshot({ files: [modified('a.ts')] });
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.delivered).toHaveLength(2);
  expect(h.delivered[1]!.message.status.files.map(f => f.path)).toEqual(['a.ts']);
  expect(h.delivered[1]!.message.status.revision!).toBeGreaterThan(h.delivered[0]!.message.status.revision!);
});

test('a burst of tool completions runs one compute per interval and always a final one', async () => {
  const h = harness();
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  // After a quiet period, 15 changes inside the collect window: one compute.
  h.advance(5_000);
  for (let i = 0; i < 15; i++) h.feed.filesChanged('ws');
  h.advance(250);
  expect(h.computes).toHaveLength(1);

  // Changes during the compute mark it dirty instead of starting another.
  h.feed.filesChanged('ws');
  h.feed.filesChanged('ws');
  await h.finish();
  expect(h.computes).toHaveLength(0);

  // The rerun waits for the minimum interval since the last start.
  h.advance(1_000);
  expect(h.computes).toHaveLength(0);
  h.advance(1_000);
  expect(h.computes).toHaveLength(1);
  await h.finish();
  expect(h.pendingTimers()).toBe(0);
});

test('Git actions and focus refresh skip the throttle', async () => {
  const h = harness();
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  h.feed.refreshRoot('ws', '/repo');
  h.advance(0);
  expect(h.computes).toHaveLength(1);
  await h.finish();

  h.feed.refresh('ws');
  h.advance(0);
  expect(h.computes).toHaveLength(1);
});

test('roots without subscribers are not computed for tool completions', () => {
  const h = harness();
  h.feed.filesChanged('ws');
  h.feed.refreshRoot('ws', '/repo');
  h.advance(5_000);
  expect(h.computes).toHaveLength(0);
});

test('reads share the serialized runner and serve the cache for watched roots', async () => {
  const h = harness();
  const first = h.feed.read('ws');
  h.advance(0);
  await h.finish();
  expect((await first).root).toBe('/repo');

  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();
  const cached = await h.feed.read('ws');
  expect(h.computes).toHaveLength(0);
  expect(cached).toEqual(h.delivered[0]!.message.status);

  // A read while a compute runs waits for a run that starts after it.
  h.feed.filesChanged('ws');
  h.advance(2_000);
  const during = h.feed.read('ws');
  h.setSnapshot({ files: [modified('b.ts')] });
  await h.finish();
  h.advance(0);
  await h.finish();
  expect((await during).files.map(f => f.path)).toEqual(['b.ts']);
});

test('disconnect and unsubscribe stop delivery and cancel pending work', async () => {
  const h = harness();
  h.feed.subscribe('c1', 'ws');
  h.feed.subscribe('c2', 'ws');
  h.advance(0);
  await h.finish();
  expect(h.delivered.map(d => d.to).sort()).toEqual(['c1', 'c2']);

  h.feed.disconnect('c1');
  h.setSnapshot({ files: [modified('a.ts')] });
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.delivered.slice(2).map(d => d.to)).toEqual(['c2']);

  h.feed.filesChanged('ws');
  h.feed.unsubscribe('c2', 'ws');
  expect(h.pendingTimers()).toBe(0);
  h.advance(5_000);
  expect(h.computes).toHaveLength(0);
});

test('a late subscriber gets the current snapshot even when nothing changed', async () => {
  const h = harness();
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  h.feed.subscribe('c2', 'ws');
  h.advance(0);
  await h.finish();
  expect(h.delivered.map(d => d.to)).toEqual(['c1', 'c2']);
  expect(h.delivered[1]!.message.status.revision).toBe(h.delivered[0]!.message.status.revision);
});

test('unknown workspaces are ignored for subscriptions and rejected for reads', () => {
  const h = harness();
  h.feed.subscribe('c1', 'missing');
  h.advance(1_000);
  expect(h.computes).toHaveLength(0);
  expect(() => h.feed.read('missing')).toThrow('Workspace not found');
});
