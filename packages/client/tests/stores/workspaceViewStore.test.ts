import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDockStore } from '@/stores/dockStore';
import {
  activeGroupView, createDefaultViewLayout, fileViewId, findViewRegion, isFileViewId, isViewOpen, isSessionViewId, sessionViewId, parseViewLayout, parsePullRequestsViewId, pullRequestsViewId,
  useWorkspaceViewStore, VIEW_LAYOUT_STORAGE_KEY, VIEW_REGIONS, WORKSPACE_VIEW_IDS, REPOSITORY_VIEW_IDS,
} from '@/stores/workspaceViewStore';

describe('workspace view placement', () => {
  const prsOne = pullRequestsViewId('server', 'one');
  const prsTwo = pullRequestsViewId('server', 'two');

  test('Pull requests is closed by default and opens as the active center tab', () => {
    const store = useWorkspaceViewStore.getState();
    expect(isViewOpen(store.layout, prsOne)).toBe(false);
    store.openInCenter(prsOne);
    const layout = useWorkspaceViewStore.getState().layout;
    expect(layout.groups.center).toEqual({ viewIds: ['conversations', 'editor', prsOne], activeId: prsOne });
    expect(parseViewLayout({ version: 5, ...layout })).toEqual(layout);
  });
  test('each workspace gets its own Pull requests tab, like files', () => {
    const store = useWorkspaceViewStore.getState();
    store.openInCenter(prsOne);
    store.openInCenter(prsTwo);
    store.openInCenter(prsOne);
    const layout = useWorkspaceViewStore.getState().layout;
    expect(layout.groups.center).toEqual({ viewIds: ['conversations', 'editor', prsOne, prsTwo], activeId: prsOne });
    expect(parsePullRequestsViewId(prsTwo)).toEqual({ serverId: 'server', workspaceId: 'two' });
    expect(parsePullRequestsViewId('prs:only-one-part')).toBeNull();
  });
  test('reopening Pull requests docked elsewhere moves it back to the center', () => {
    const store = useWorkspaceViewStore.getState();
    store.openInCenter(prsOne);
    store.moveView(prsOne, 'right');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, prsOne)).toBe('right');
    store.openInCenter(prsOne);
    const layout = useWorkspaceViewStore.getState().layout;
    expect(findViewRegion(layout, prsOne)).toBe('center');
    expect(layout.groups.right.viewIds).not.toContain(prsOne);
  });
  test('closing Pull requests removes it and returns to the previous center tab', () => {
    const store = useWorkspaceViewStore.getState();
    store.openInCenter(prsOne);
    store.removeView(prsOne);
    const layout = useWorkspaceViewStore.getState().layout;
    expect(isViewOpen(layout, prsOne)).toBe(false);
    expect(layout.groups.center.activeId).toBe('editor');
  });
  test('a saved layout with the old single Pull requests tab keeps its arrangement', () => {
    const store = useWorkspaceViewStore.getState();
    store.moveView('terminals', 'left');
    const saved = structuredClone(useWorkspaceViewStore.getState().layout);
    saved.groups.center = { viewIds: ['conversations', 'editor', 'pull-requests' as never], activeId: 'pull-requests' as never };
    const migrated = parseViewLayout({ version: 5, ...saved })!;
    expect(migrated.groups.center).toEqual({ viewIds: ['conversations', 'editor'], activeId: 'conversations' });
    expect(findViewRegion(migrated, 'terminals')).toBe('left');
  });
  test('adds Usage to saved left splits without resetting selections or placement', () => {
    const store = useWorkspaceViewStore.getState();
    store.moveView('explorer', 'left');
    store.splitView('explorer', 'down', WORKSPACE_VIEW_IDS);
    const saved = structuredClone(useWorkspaceViewStore.getState().layout);
    for (const group of Object.values(saved.groups)) group.viewIds = group.viewIds.filter((id) => id !== 'usage');
    const migrated = parseViewLayout({ version: 5, ...saved })!;
    expect(migrated.roots).toEqual(saved.roots);
    expect(migrated.groups.left.activeId).toBe(saved.groups.left.activeId);
    expect(migrated.groups.left.viewIds).toEqual([...saved.groups.left.viewIds, 'usage']);
    expect(findViewRegion(migrated, 'usage')).toBe('left');
    useWorkspaceViewStore.setState({ layout: migrated });
    store.moveView('usage', 'bottom');
    store.hideView('usage');
    const restored = parseViewLayout({ version: 5, ...useWorkspaceViewStore.getState().layout })!;
    expect(findViewRegion(restored, 'usage')).toBe('bottom');
    expect(restored.hidden).toContain('usage');
    expect(Object.values(restored.groups).flatMap((group) => group.viewIds).filter((id) => id === 'usage')).toHaveLength(1);
  });
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('moves a view exactly once, selects it, opens its destination and closes an empty source', () => {
    useWorkspaceViewStore.getState().moveView('terminals', 'left');
    const { layout } = useWorkspaceViewStore.getState();
    expect(layout.groups.left).toEqual({ viewIds: ['sessions', 'usage', 'terminals'], activeId: 'terminals' });
    expect(layout.groups.bottom).toEqual({ viewIds: [], activeId: null });
    expect(Object.values(layout.groups).flatMap((group) => group.viewIds).sort()).toEqual([...WORKSPACE_VIEW_IDS].sort());
    expect(useDockStore.getState().docks.left.open).toBe(true);
    expect(useDockStore.getState().docks.bottom.open).toBe(false);
    expect(parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!))).toEqual(layout);
  });

  test('reorders in both directions and persists insertion positions without duplicating tabs', () => {
    const store = useWorkspaceViewStore.getState();
    store.moveView('worktrees', 'right', 'explorer');
    expect(useWorkspaceViewStore.getState().layout.groups.right.viewIds).toEqual(['worktrees', 'explorer', 'changes', 'branches']);
    store.moveView('worktrees', 'right', 'branches');
    expect(useWorkspaceViewStore.getState().layout.groups.right.viewIds).toEqual(['explorer', 'changes', 'worktrees', 'branches']);
    store.moveView('worktrees', 'right', null);
    store.moveView('worktrees', 'right', 'worktrees');
    expect(useWorkspaceViewStore.getState().layout.groups.right.viewIds).toEqual([...REPOSITORY_VIEW_IDS]);
    store.moveView('terminals', 'right', 'changes');
    const { layout } = useWorkspaceViewStore.getState();
    expect(layout.groups.right.viewIds).toEqual(['explorer', 'terminals', 'changes', 'branches', 'worktrees']);
    expect(layout.groups.right.activeId).toBe('terminals');
    expect(layout.groups.bottom.viewIds).toEqual([]);
    expect(Object.values(layout.groups).flatMap((group) => group.viewIds).sort()).toEqual([...WORKSPACE_VIEW_IDS].sort());
    expect(parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!))).toEqual(layout);
  });

  test('hidden views keep their placement and activation restores them there', () => {
    const store = useWorkspaceViewStore.getState();
    store.moveView('editor', 'right');
    store.hideView('editor');
    expect(activeGroupView(useWorkspaceViewStore.getState().layout, 'right', WORKSPACE_VIEW_IDS)).toBe('explorer');
    useDockStore.getState().setDockOpen('right', false);
    store.activateView('editor');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, 'editor')).toBe('right');
    expect(activeGroupView(useWorkspaceViewStore.getState().layout, 'right', WORKSPACE_VIEW_IDS)).toBe('editor');
    expect(useDockStore.getState().docks.right.open).toBe(true);
  });

  test('unavailable editor falls back to conversations without changing persisted selection', () => {
    useWorkspaceViewStore.getState().activateView('editor');
    expect(activeGroupView(useWorkspaceViewStore.getState().layout, 'center', ['conversations'])).toBe('conversations');
    expect(useWorkspaceViewStore.getState().layout.groups.center.activeId).toBe('editor');
  });

  test('reset restores all views including hidden ones', () => {
    useWorkspaceViewStore.getState().moveView('conversations', 'bottom');
    useWorkspaceViewStore.getState().hideView('sessions');
    useWorkspaceViewStore.getState().resetLayout();
    expect(useWorkspaceViewStore.getState().layout).toEqual(createDefaultViewLayout());
    expect(useDockStore.getState().docks.bottom.open).toBe(false);
  });

  test('storage failures do not prevent moving views', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => useWorkspaceViewStore.getState().moveView('explorer', 'center')).not.toThrow();
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, 'explorer')).toBe('center');
  });

  test('each tool and file keeps one placement through repeated moves, opens and restores', () => {
    const file = fileViewId('server\u0001workspace\u0001/root\u0001main.ts');
    const ids = [...WORKSPACE_VIEW_IDS, file];
    const store = useWorkspaceViewStore.getState();
    for (const id of ids) {
      for (const region of VIEW_REGIONS) {
        store.moveView(id, region);
        store.moveView(id, region);
        store.hideView(id);
        store.activateView(id);
        store.activateView(id);
        const layout = useWorkspaceViewStore.getState().layout;
        expect(Object.values(layout.groups).flatMap((group) => group.viewIds).filter((view) => view === id)).toEqual([id]);
        expect(findViewRegion(layout, id)).toBe(region);
        expect(layout.groups[region].activeId).toBe(id);
        expect(parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!))).toEqual(layout);
      }
    }
  });

  test.each([1, 2])('migrates hidden Files in a custom dock from v%s without losing selections', (version) => {
    const file = fileViewId('s\u0001w\u0001\u0001main.ts');
    const saved = {
      version,
      groups: {
        left: { viewIds: ['sessions'], activeId: 'sessions' },
        center: { viewIds: ['conversations', 'editor'], activeId: 'conversations' },
        right: { viewIds: version === 2 ? [file] : [], activeId: version === 2 ? file : null },
        bottom: { viewIds: ['files', 'terminals'], activeId: 'files' },
      },
      hidden: ['files'],
    };
    const migrated = parseViewLayout(saved)!;
    expect(migrated.groups.bottom).toEqual({ viewIds: [...REPOSITORY_VIEW_IDS, 'terminals'], activeId: 'explorer' });
    expect(migrated.hidden).toEqual([...REPOSITORY_VIEW_IDS]);
    expect(migrated.groups.right).toEqual(saved.groups.right);
    expect(parseViewLayout({ version: 3, ...migrated })).toEqual(migrated);
    saved.groups.left.viewIds.push('files');
    expect(parseViewLayout(saved)).toBeNull();
  });

  test('migrates a v1 editor placement and writes document positions as v5', () => {
    const legacy = {
      groups: {
        left: { viewIds: ['sessions'], activeId: 'sessions' },
        center: { viewIds: ['conversations', 'editor'], activeId: 'conversations' },
        right: { viewIds: ['files'], activeId: 'files' },
        bottom: { viewIds: ['terminals'], activeId: 'terminals' },
      },
      hidden: [],
    };
    legacy.groups.center.viewIds = ['conversations'];
    legacy.groups.right.viewIds.push('editor');
    legacy.groups.right.activeId = 'editor';
    const parsed = parseViewLayout({ version: 1, ...legacy });
    expect(parsed?.groups.right).toEqual({ viewIds: [...REPOSITORY_VIEW_IDS, 'editor'], activeId: 'editor' });
    useWorkspaceViewStore.setState({ layout: parsed! });
    const file = fileViewId('server\u0001workspace\u0001/root\u0001src/main.ts');
    useWorkspaceViewStore.getState().activateView(file);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, file)).toBe('right');
    expect(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!).version).toBe(5);
    expect(parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!))).toEqual(useWorkspaceViewStore.getState().layout);
  });

  test('resource reset keeps open file identities and moves them back to center', () => {
    const file = fileViewId('server\u0001workspace\u0001\u0001readme.md');
    const store = useWorkspaceViewStore.getState();
    store.activateView(file);
    store.moveView(file, 'bottom');
    store.hideView(file);
    store.resetLayout();
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).toContain(file);
    expect(useWorkspaceViewStore.getState().layout.hidden).not.toContain(file);
  });

  test('session resources inherit the old Conversations placement and persist independently by server', () => {
    const legacy = createDefaultViewLayout();
    legacy.groups.center.viewIds = ['editor'];
    legacy.groups.center.activeId = 'editor';
    legacy.groups.bottom.viewIds.push('conversations');
    useWorkspaceViewStore.setState({ layout: parseViewLayout({ version: 3, ...legacy })! });
    const first = sessionViewId('server-a', 'same-session');
    const second = sessionViewId('server-b', 'same-session');
    useWorkspaceViewStore.getState().activateView(first);
    useWorkspaceViewStore.getState().activateView(second);
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, first)).toBe('bottom');
    useWorkspaceViewStore.getState().moveView(first, 'left');
    expect(findViewRegion(useWorkspaceViewStore.getState().layout, second)).toBe('bottom');
    expect(parseViewLayout(JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!))).toEqual(useWorkspaceViewStore.getState().layout);
    useWorkspaceViewStore.getState().resetLayout();
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).toEqual(['conversations', 'editor', first, second]);
  });

  test.each(['session:', 'session:a:', 'session::b', 'session:a:b:c', 'session:%zz:b', 'session:a:%61'])('rejects malformed session identities: %s', (id) => {
    expect(isSessionViewId(id)).toBe(false);
    const layout = createDefaultViewLayout();
    expect(parseViewLayout({ version: 4, ...layout, groups: { ...layout.groups, center: { viewIds: [...layout.groups.center.viewIds, id], activeId: id } } })).toBeNull();
  });

  test('closing one resource retains its neighbors and removes hidden references', () => {
    const first = fileViewId('s\u0001w\u0001\u0001a.ts');
    const second = fileViewId('s\u0001w\u0001\u0001b.ts');
    const store = useWorkspaceViewStore.getState();
    store.activateView(first);
    store.activateView(second);
    store.activateView(first);
    store.removeView(first);
    expect(activeGroupView(useWorkspaceViewStore.getState().layout, 'center', ['conversations', second])).toBe(second);
    store.hideView(second);
    store.removeView(second);
    expect(useWorkspaceViewStore.getState().layout.hidden).toEqual([]);
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).toEqual(['conversations', 'editor']);
  });

  test.each(['file:', 'file:abc', 'file:%zz', 'file:a%01b%01c', 'file:a%01b%01%01', 'session:unknown'])('rejects malformed resource IDs: %s', (id) => {
    expect(isFileViewId(id)).toBe(false);
    const layout = createDefaultViewLayout();
    const payload = { version: 3, ...layout, groups: { ...layout.groups, center: { viewIds: [...layout.groups.center.viewIds, id], activeId: id } } };
    expect(parseViewLayout(payload)).toBeNull();
  });

  test.each([
    null, [], { version: 6, ...createDefaultViewLayout() },
    { version: 1, groups: {}, hidden: [] },
    { version: 3, ...createDefaultViewLayout(), hidden: ['unknown'] },
    { version: 3, ...createDefaultViewLayout(), groups: { ...createDefaultViewLayout().groups, left: { viewIds: ['sessions', 'explorer'], activeId: 'sessions' } } },
    { version: 3, ...createDefaultViewLayout(), groups: { ...createDefaultViewLayout().groups, left: { viewIds: [], activeId: null } } },
    { version: 3, ...createDefaultViewLayout(), groups: { ...createDefaultViewLayout().groups, left: { viewIds: ['sessions'], activeId: 'explorer' } } },
  ])('rejects malformed, incomplete, duplicated or unsupported layouts: %j', (value) => {
    expect(parseViewLayout(value)).toBeNull();
  });
});
