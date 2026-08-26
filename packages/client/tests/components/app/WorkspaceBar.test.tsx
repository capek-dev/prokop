import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Workspace } from '@prokopai/sdk';
import {
  SessionsVisibilityButton,
  WorkbenchVisibilityButton,
} from '@/components/app/WorkspaceBar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';

const mocks = vi.hoisted(() => ({
  isMobile: false,
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

const workspace = {
  id: 'workspace-1',
  name: 'Dock Workspace',
  path: '/workspace',
  additionalPaths: [],
  isVirtual: false,
  settings: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as Workspace;

function renderControls() {
  return render(
    <SidebarProvider panelId="sessions">
      <SessionsVisibilityButton />
      <WorkbenchVisibilityButton />
    </SidebarProvider>,
  );
}

describe('workspace dock visibility controls', () => {
  beforeEach(() => {
    mocks.isMobile = false;
    useChatLayoutStore.setState({
      showFilesPanel: false,
      mobileSurface: 'chat',
    });
    useServerDataStore.setState({
      activeWorkspace: workspace,
      workspaces: [workspace],
      agents: [],
    });
  });

  test('toggles desktop Sessions and Workbench state', () => {
    const { getByRole } = renderControls();

    fireEvent.click(getByRole('button', { name: 'Hide Sessions' }));
    expect(getByRole('button', { name: 'Show Sessions' })).toBeInTheDocument();

    fireEvent.click(getByRole('button', { name: 'Show Files' }));
    expect(useChatLayoutStore.getState().showFilesPanel).toBe(true);
    expect(getByRole('button', { name: 'Hide Files' })).toBeInTheDocument();
  });

  test('switches phone surfaces and treats Editor as Files-active', () => {
    mocks.isMobile = true;
    const { getByRole } = renderControls();

    fireEvent.click(getByRole('button', { name: 'Show Sessions' }));
    expect(useChatLayoutStore.getState().mobileSurface).toBe('sessions');

    fireEvent.click(getByRole('button', { name: 'Hide Sessions' }));
    fireEvent.click(getByRole('button', { name: 'Show Files' }));
    expect(useChatLayoutStore.getState().mobileSurface).toBe('files');

    act(() => useChatLayoutStore.getState().setMobileSurface('editor'));
    expect(getByRole('button', { name: 'Hide Files' })).toBeInTheDocument();
    fireEvent.click(getByRole('button', { name: 'Hide Files' }));
    expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
    expect(useChatLayoutStore.getState().showFilesPanel).toBe(false);
  });
});
