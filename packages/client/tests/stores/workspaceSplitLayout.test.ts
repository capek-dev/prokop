import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createDefaultViewLayout, findViewGroup, findViewRegion, parseViewLayout, sessionViewId, useWorkspaceViewStore, VIEW_LAYOUT_STORAGE_KEY, WORKSPACE_VIEW_IDS } from '@/stores/workspaceViewStore';
import { treeGroups, type ViewTree } from '@/stores/workspaceSplitLayout';
import { useDockStore } from '@/stores/dockStore';

describe('workspace splits', () => {
  beforeEach(() => {
    useWorkspaceViewStore.setState({ layout: createDefaultViewLayout() });
    useDockStore.setState(useDockStore.getInitialState());
  });
  afterEach(() => { localStorage.clear(); });

  test('restricts side and bottom directions and refuses to split a sole visible tab', () => {
    const store = useWorkspaceViewStore.getState();
    expect(store.splitView('explorer', 'right', WORKSPACE_VIEW_IDS)).toBeNull();
    expect(store.splitView('sessions', 'down', WORKSPACE_VIEW_IDS)).toBeNull();
    expect(store.splitView('explorer', 'down', ['explorer'])).toBeNull();
    const lower = store.splitView('explorer', 'down', WORKSPACE_VIEW_IDS)!;
    expect(treeGroups(useWorkspaceViewStore.getState().layout.roots.right)).toEqual(['right', lower]);
    expect(store.splitView('explorer', 'down', WORKSPACE_VIEW_IDS)).toBeNull();
    store.moveView('branches', 'bottom');
    expect(store.splitView('branches', 'down', WORKSPACE_VIEW_IDS)).toBeNull();
    expect(store.splitView('branches', 'right', WORKSPACE_VIEW_IDS)).not.toBeNull();
  });

  test('supports nested center splits, selection, resizing, persistence and v4 migration', () => {
    const store = useWorkspaceViewStore.getState();
    for (const id of ['explorer', 'changes', 'branches'] as const) store.moveView(id, 'center');
    const column = store.splitView('explorer', 'right', WORKSPACE_VIEW_IDS)!;
    store.moveView('changes', column);
    const row = store.splitView('changes', 'down', WORKSPACE_VIEW_IDS)!;
    const layout = useWorkspaceViewStore.getState().layout;
    expect(treeGroups(layout.roots.center)).toEqual(['center', column, row]);
    expect(findViewRegion(layout, 'changes')).toBe('center');
    expect(findViewGroup(layout, 'changes')).toBe(row);
    expect(layout.groups[column].activeId).toBe('explorer');
    expect(layout.groups[row].activeId).toBe('changes');
    if (layout.roots.center.kind !== 'split') throw new Error('Missing split');
    store.resizeSplit(layout.roots.center.id, 0.63);
    const saved = JSON.parse(localStorage.getItem(VIEW_LAYOUT_STORAGE_KEY)!);
    expect(saved.roots.center.ratio).toBe(0.63);
    expect(parseViewLayout(saved)).toEqual(useWorkspaceViewStore.getState().layout);
    const original = createDefaultViewLayout();
    expect(parseViewLayout({ version: 4, groups: original.groups, hidden: [] })).toEqual(original);
  });

  test('closing or moving the last tab collapses its group and preserves legacy anchors', () => {
    const store = useWorkspaceViewStore.getState();
    const first = sessionViewId('server', 'one');
    const second = sessionViewId('server', 'two');
    store.ensureViews([first, second]);
    const split = store.splitView(second, 'right', [first, second])!;
    store.removeView(first);
    let layout = useWorkspaceViewStore.getState().layout;
    expect(treeGroups(layout.roots.center)).toEqual([split]);
    expect(layout.groups[split].viewIds).toContain('conversations');
    expect(layout.groups[split].viewIds).toContain('editor');
    store.moveView(second, 'left');
    layout = useWorkspaceViewStore.getState().layout;
    expect(treeGroups(layout.roots.center)).toHaveLength(1);
    expect(layout.groups[split].viewIds).not.toContain(second);
    expect(parseViewLayout({ version: 5, ...layout })).toEqual(layout);
    store.resetLayout();
    expect(treeGroups(useWorkspaceViewStore.getState().layout.roots.center)).toEqual(['center']);
    expect(useWorkspaceViewStore.getState().layout.groups.center.viewIds).toContain(second);
  });

  test('moving between groups remains unique and hiding a final tab collapses its group', () => {
    const store = useWorkspaceViewStore.getState();
    const split = store.splitView('explorer', 'down', WORKSPACE_VIEW_IDS)!;
    store.moveView('changes', split, 'explorer');
    store.moveView('explorer', 'right', 'branches');
    expect(useWorkspaceViewStore.getState().layout.groups[split].viewIds).toEqual(['changes']);
    store.hideView('changes');
    const layout = useWorkspaceViewStore.getState().layout;
    expect(treeGroups(layout.roots.right)).toEqual(['right']);
    expect(layout.groups.right.viewIds).toContain('changes');
    expect(layout.hidden).toContain('changes');
    expect(Object.values(layout.groups).flatMap((group) => group.viewIds).sort()).toEqual([...WORKSPACE_VIEW_IDS].sort());
  });

  test('rejects invalid trees, ratios, directions, missing groups and duplicate membership', () => {
    const store = useWorkspaceViewStore.getState();
    store.splitView('explorer', 'down', WORKSPACE_VIEW_IDS);
    const valid = { version: 5, ...store.layout, ...useWorkspaceViewStore.getState().layout };
    const root = valid.roots.right;
    if (root.kind !== 'split') throw new Error('Missing split');
    const invalid: ViewTree[] = [
      { ...root, ratio: Number.NaN }, { ...root, ratio: 0 }, { ...root, direction: 'right' },
      { ...root, second: root.first }, { kind: 'group', groupId: 'missing' },
    ];
    for (const tree of invalid) expect(parseViewLayout({ ...valid, roots: { ...valid.roots, right: tree } })).toBeNull();
    expect(parseViewLayout({ ...valid, groups: { ...valid.groups, 'group-unused': { viewIds: [], activeId: null } } })).toBeNull();
    expect(parseViewLayout({ ...valid, groups: { ...valid.groups, left: { viewIds: ['sessions', 'explorer'], activeId: 'sessions' } } })).toBeNull();
  });
});
