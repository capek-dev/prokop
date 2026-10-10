import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { isLazyFolder, useLazyTreeFolders, type LazyTreeModel } from '@/components/files/useLazyTreeFolders';

/** A tree model that holds paths and expanded folders, and notifies like Pierre's subscribe. */
function fakeModel(paths: string[]) {
  const present = new Set(paths);
  const expanded = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const rows = () => [...present].sort().map((path) => ({
    path, kind: path.endsWith('/') ? 'directory' : 'file', isExpanded: expanded.has(path),
  }));
  const model: LazyTreeModel = {
    getItem: (path) => (present.has(path) ? {} : null),
    getVisibleCount: () => present.size,
    getVisibleRows: (start, end) => rows().slice(start, end),
    batch: (operations) => {
      for (const op of operations) {
        if (op.type === 'add') present.add(op.path);
        else for (const path of [...present]) if (path === op.path || (op.recursive && path.startsWith(op.path))) present.delete(path);
      }
      notify();
    },
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return {
    model,
    present,
    expand(path: string) { expanded.add(path); notify(); },
  };
}

function fakeClient(children: Record<string, string[]>) {
  const treeChildren = vi.fn(async (_workspaceId: string, path: string) => ({
    root: '/repo', path, paths: children[path] ?? [], truncated: false,
  }));
  return { client: { http: { files: { treeChildren } } } as unknown as ProkopaiClient, treeChildren };
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

/** Runs queued frames and settles the loads they start, until nothing is left. */
async function flush() {
  await act(async () => {
    for (let round = 0; round < 5; round++) {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(0));
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('isLazyFolder', () => {
  test('folders at or below an unwalked folder load on expand; files and other folders do not', () => {
    const unwalked = ['node_modules/', 'packages/web/dist/'];
    expect(isLazyFolder('node_modules/', unwalked)).toBe(true);
    expect(isLazyFolder('node_modules/react/', unwalked)).toBe(true);
    expect(isLazyFolder('packages/web/dist/assets/', unwalked)).toBe(true);
    expect(isLazyFolder('node_modules/react/index.js', unwalked)).toBe(false);
    expect(isLazyFolder('src/', unwalked)).toBe(false);
    expect(isLazyFolder('node_modules_backup/', unwalked)).toBe(false);
  });
});

describe('useLazyTreeFolders', () => {
  test('expanding node_modules loads one level, and a package loads only when it is expanded', async () => {
    const tree = fakeModel(['node_modules/', 'src/', 'src/a.ts']);
    const { client, treeChildren } = fakeClient({
      node_modules: ['node_modules/react/', 'node_modules/zod/'],
      'node_modules/react': ['node_modules/react/index.js'],
    });
    renderHook(() => useLazyTreeFolders({ model: tree.model, sdkClient: client, workspaceId: 'ws', ignored: ['node_modules/'] }));
    await flush();
    expect(treeChildren).not.toHaveBeenCalled();

    tree.expand('node_modules/');
    await flush();
    expect(treeChildren).toHaveBeenCalledWith('ws', 'node_modules', { root: undefined });
    expect(tree.present.has('node_modules/react/')).toBe(true);
    expect(tree.present.has('node_modules/react/index.js')).toBe(false);

    tree.expand('node_modules/react/');
    await flush();
    expect(tree.present.has('node_modules/react/index.js')).toBe(true);
    expect(treeChildren).toHaveBeenCalledTimes(2);
  });

  test('ordinary folders never load from the server, and a loaded folder is not fetched again', async () => {
    const tree = fakeModel(['node_modules/', 'src/']);
    const { client, treeChildren } = fakeClient({ node_modules: ['node_modules/react/'] });
    renderHook(() => useLazyTreeFolders({ model: tree.model, sdkClient: client, workspaceId: 'ws', ignored: ['node_modules/'] }));

    tree.expand('src/');
    tree.expand('node_modules/');
    await flush();
    tree.expand('node_modules/');
    await flush();

    expect(treeChildren).toHaveBeenCalledTimes(1);
  });

  test('after the tree is rebuilt, an open lazy folder loads again', async () => {
    const tree = fakeModel(['node_modules/']);
    const { client, treeChildren } = fakeClient({ node_modules: ['node_modules/react/'] });
    const { result } = renderHook(() => useLazyTreeFolders({ model: tree.model, sdkClient: client, workspaceId: 'ws', ignored: ['node_modules/'] }));
    tree.expand('node_modules/');
    await flush();

    // resetPaths drops the loaded children but keeps the folder open.
    tree.present.delete('node_modules/react/');
    act(() => result.current.reset());
    await flush();

    expect(treeChildren).toHaveBeenCalledTimes(2);
    expect(tree.present.has('node_modules/react/')).toBe(true);
  });

  test('a refresh reloads open ignored folders: new files appear and deleted ones disappear', async () => {
    const tree = fakeModel(['out/', 'src/', 'src/a.ts']);
    const children: Record<string, string[]> = { out: ['out/hero.png', 'out/old/'], 'out/old': ['out/old/a.png'] };
    const { client, treeChildren } = fakeClient(children);
    const { result } = renderHook(() => useLazyTreeFolders({ model: tree.model, sdkClient: client, workspaceId: 'ws', ignored: ['out/'] }));
    tree.expand('out/');
    await flush();
    tree.expand('out/old/');
    await flush();
    expect(tree.present.has('out/old/a.png')).toBe(true);

    // On disk: new renders arrive, `out/old/` is deleted. The tree walk itself is unchanged.
    // `out/old` still answers here, so its reload must not resurrect the removed folder.
    children.out = ['out/hero.png', 'out/hero.dark.png', 'out/mobile.dark.png'];
    act(() => result.current.reset());
    await flush();

    expect([...tree.present].filter((path) => path.startsWith('out/')).sort()).toEqual([
      'out/', 'out/hero.dark.png', 'out/hero.png', 'out/mobile.dark.png',
    ]);
    expect(tree.present.has('src/a.ts')).toBe(true);
    // Both open folders loaded twice: once on expand, once on refresh.
    expect(treeChildren).toHaveBeenCalledTimes(4);
  });
});
