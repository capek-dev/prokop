import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { resolveFilesPanelRoot } from '@/lib/sessionWorktree';
import type { Workspace } from '@prokopai/sdk';
import { useChatLayoutStore, useSessionChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

beforeEach(() => {
  useChatLayoutStore.setState({ sessionFilesLayouts: {} });
  useServerDataStore.setState({ serverId: 'server', activeWorkspace: { id: 'workspace' } as Workspace });
  useSessionBoardStore.setState({ focusedSessionId: 'a' });
});

afterEach(() => {
  cleanup();
  useChatLayoutStore.setState({ sessionFilesLayouts: {} });
  useServerDataStore.setState({ serverId: null, activeWorkspace: null });
  useSessionBoardStore.setState({ focusedSessionId: null });
});

test('saved roots are checked before use without losing pins during discovery', () => {
  const input = { workspacePath: '/primary', pinned: true, pinnedRoot: '/other' };
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary', '/other'] }).selectedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary'] }).selectedRoot).toBe('/primary');
  // Discovery or removal never modifies the saved selection.
  expect(input.pinnedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, allowedRoots: ['/primary', '/other'] }).selectedRoot).toBe('/other');
  expect(resolveFilesPanelRoot({ ...input, workspaceRootId: 'missing', allowedRoots: ['/primary'] }).blocked).toBe(true);
});

test('restores each session repository pin, Files tab and workbench surface', () => {
  const { result } = renderHook(() => ({
    root: useSessionChatLayoutStore((s) => s.filesPanelRoot),
    pinned: useSessionChatLayoutStore((s) => s.filesPanelRootPinned),
    tab: useSessionChatLayoutStore((s) => s.filesPanelTab),
    surface: useSessionChatLayoutStore((s) => s.workbenchSurface),
  }));
  act(() => {
    const layout = useChatLayoutStore.getState();
    layout.setFilesPanelRoot('/other-repo');
    layout.setFilesPanelRootPinned(true);
    layout.setFilesPanelTab('branches');
    layout.setWorkbenchSurface('branches');
  });
  expect(result.current).toEqual({ root: '/other-repo', pinned: true, tab: 'branches', surface: 'branches' });
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'b' }));
  expect(result.current).toEqual({ root: null, pinned: false, tab: 'project', surface: 'explorer' });
  act(() => useChatLayoutStore.getState().setFilesPanelRoot('/third-repo'));
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'a' }));
  expect(result.current.root).toBe('/other-repo');
  expect(result.current.tab).toBe('branches');
  act(() => useSessionBoardStore.setState({ focusedSessionId: 'b' }));
  expect(result.current.root).toBe('/third-repo');
});

test('same session IDs do not share selection across servers or workspaces', () => {
  const { result } = renderHook(() => useSessionChatLayoutStore((s) => s.filesPanelRoot));
  act(() => useChatLayoutStore.getState().setFilesPanelRoot('/repo'));
  act(() => useServerDataStore.setState({ serverId: 'another-server' }));
  expect(result.current).toBeNull();
  act(() => useServerDataStore.setState({ serverId: 'server', activeWorkspace: { id: 'another-workspace' } as Workspace }));
  expect(result.current).toBeNull();
  act(() => useServerDataStore.setState({ activeWorkspace: { id: 'workspace' } as Workspace }));
  expect(result.current).toBe('/repo');
});
