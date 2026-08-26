import { createRef } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { KeyboardShortcutsConfig } from '@/hooks/useKeyboardShortcuts';
import { useAppKeyboardHandlers } from '@/hooks/useAppKeyboardHandlers';
import {
  SessionPaneRegistryContext,
  type SessionPaneRegistry,
} from '@/contexts/SessionPaneRegistryContext';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';

const mocks = vi.hoisted(() => ({
  keyboardConfig: null as KeyboardShortcutsConfig | null,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    state: { location: { pathname: '/server/server-1/workspace' } },
    navigate: vi.fn(),
  }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ serverId: 'server-1' }),
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: '/server/server-1/workspace' } }),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: (config: KeyboardShortcutsConfig) => {
    mocks.keyboardConfig = config;
  },
}));

vi.mock('@/hooks/useBoardFocus', () => ({
  useBoardFocus: () => vi.fn(),
}));

const paneRegistry: SessionPaneRegistry = {
  panes: new Map(),
  register: vi.fn(),
  unregister: vi.fn(),
  getHandle: vi.fn(),
};

function Harness() {
  useAppKeyboardHandlers({
    sidebarRef: createRef(),
    terminalPanelRef: createRef(),
    filesPanelRef: createRef(),
    chatInputRef: createRef(),
    activeWorkspace: null,
    primaryPreconfigs: [],
    handleInterruptSession: vi.fn(),
    serverId: 'server-1',
    createSession: vi.fn(),
    setSidebarOpen: vi.fn(),
  });
  return null;
}

function renderHarness() {
  return render(
    <SessionPaneRegistryContext.Provider value={paneRegistry}>
      <Harness />
      <div data-mobile-surface="sessions" tabIndex={-1}>
        <button type="button" data-sidebar="menu-button">
          Session one
        </button>
      </div>
    </SessionPaneRegistryContext.Provider>,
  );
}

describe('useAppKeyboardHandlers phone Sessions surface', () => {
  beforeEach(() => {
    mocks.keyboardConfig = null;
    useChatLayoutStore.setState({ mobileSurface: 'chat' });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    });
  });

  test('Mod+1 handler opens the Sessions surface', () => {
    renderHarness();

    act(() => mocks.keyboardConfig?.onOpenSidebar());

    expect(useChatLayoutStore.getState().mobileSurface).toBe('sessions');
  });

  test('Shift+Escape handler returns focused Sessions to Chat', () => {
    const { getByRole } = renderHarness();
    useChatLayoutStore.setState({ mobileSurface: 'sessions' });
    getByRole('button', { name: 'Session one' }).focus();

    act(() => mocks.keyboardConfig?.onCloseFocusedPanel());

    expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
  });
});
