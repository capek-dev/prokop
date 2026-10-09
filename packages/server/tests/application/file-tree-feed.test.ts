import { expect, test } from 'bun:test';
import type { FileTreeMessage, FileTreeUpdate } from '@prokopai/sdk';
import { createFileTreeFeed, diffTreePaths, type FileTreeSnapshot } from '@/application/files/file-tree-feed';

/** Deterministic clock and timers; walks resolve only when the test says so. */
function harness(paths: string[]) {
  let time = 1_000;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const computes: Array<(snapshot: FileTreeSnapshot) => void> = [];
  const delivered: Array<{ to: string; message: FileTreeMessage }> = [];
  let snapshot: FileTreeSnapshot = { root: '/repo', isMain: true, paths, truncated: false };

  const feed = createFileTreeFeed<string>({
    resolveRoot: (_workspaceId, rootQuery) => rootQuery ?? '/repo',
    compute: () => new Promise((resolve) => computes.push(resolve)),
    deliver: (to, message) => delivered.push({ to, message }),
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
    setPaths(next: string[]) { snapshot = { ...snapshot, paths: next }; },
    setIgnored(next: string[]) { snapshot = { ...snapshot, ignored: next }; },
    updates: (to: string): FileTreeUpdate[] => delivered.filter(d => d.to === to).map(d => d.message.update),
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
    async finish() {
      const pending = computes.shift();
      if (!pending) throw new Error('no pending walk');
      pending(snapshot);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const base = ['README.md', 'src/', 'src/a.ts', 'src/b.ts', 'src/lib/', 'src/lib/c.ts'];

test('a subscriber gets the whole tree, then nothing while paths stay the same', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();
  const [first] = h.updates('c1');
  expect(first).toMatchObject({ kind: 'snapshot', tree: { root: '/repo', paths: base } });
  expect(h.delivered[0]!.message).toMatchObject({ type: 'files.tree', workspaceId: 'ws', root: '/repo' });

  // Edits and read-only shell calls walk the tree but push nothing.
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.delivered).toHaveLength(1);
});

test('added and removed paths arrive as a delta on top of the held revision', async () => {
  const unchanged = ['docs/', ...Array.from({ length: 10 }, (_, i) => `docs/${i}.md`)];
  const h = harness([...base, ...unchanged]);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();
  const snapshot = h.updates('c1')[0] as Extract<FileTreeUpdate, { kind: 'snapshot' }>;

  h.setPaths(['README.md', 'src/', 'src/a.ts', 'src/new.ts', 'src/z/', 'src/z/d.ts', ...unchanged]);
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();

  const delta = h.updates('c1')[1]!;
  expect(delta).toEqual({
    kind: 'delta',
    baseRevision: snapshot.tree.revision!,
    revision: expect.any(Number),
    added: ['src/new.ts', 'src/z/', 'src/z/d.ts'],
    removed: ['src/b.ts', 'src/lib/', 'src/lib/c.ts'],
    truncated: false,
  });
  expect((delta as { revision: number }).revision).toBeGreaterThan(snapshot.tree.revision!);
});

test('a change touching most of the tree is sent as a snapshot', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  h.setPaths(['other/', 'other/x.ts']);
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.updates('c1')[1]).toMatchObject({ kind: 'snapshot', tree: { paths: ['other/', 'other/x.ts'] } });
});

test('a changed ignore set alone is sent as a snapshot that carries it', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  // A .gitignore edit: same paths, different ignored ones.
  h.setIgnored(['src/lib/']);
  h.feed.filesChanged('ws');
  h.advance(2_000);
  await h.finish();
  expect(h.updates('c1')[1]).toMatchObject({ kind: 'snapshot', tree: { paths: base, ignored: ['src/lib/'] } });
});

test('a late subscriber gets the whole tree while existing ones get the delta', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  h.setPaths([...base, 'src/new.ts']);
  h.feed.subscribe('c2', 'ws');
  h.advance(0);
  await h.finish();
  expect(h.updates('c1')[1]).toMatchObject({ kind: 'delta', added: ['src/new.ts'], removed: [] });
  expect(h.updates('c2')).toEqual([{ kind: 'snapshot', tree: expect.objectContaining({ paths: [...base, 'src/new.ts'] }) }]);
});

test('a subscriber joining during a walk never gets a delta it cannot apply', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  h.feed.filesChanged('ws');
  h.advance(2_000);
  h.feed.subscribe('c2', 'ws');
  h.setPaths([...base, 'src/new.ts']);
  await h.finish();
  expect(h.updates('c1')[1]).toMatchObject({ kind: 'delta' });
  expect(h.updates('c2')[0]).toMatchObject({ kind: 'snapshot' });
});

test('reads of a watched root serve the pushed tree without walking', async () => {
  const h = harness(base);
  h.feed.subscribe('c1', 'ws');
  h.advance(0);
  await h.finish();

  const read = await h.feed.read('ws');
  expect(h.computes).toHaveLength(0);
  expect(read.paths).toEqual(base);
  expect(read.revision).toBe((h.updates('c1')[0] as Extract<FileTreeUpdate, { kind: 'snapshot' }>).tree.revision!);
});

test('diffTreePaths keeps input order', () => {
  expect(diffTreePaths(['a', 'b', 'c'], ['c', 'd', 'a'])).toEqual({ added: ['d'], removed: ['b'] });
});
