import { render } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Workspace } from '@prokopai/sdk';
import { WorkspaceBoardToolbar } from '@/components/app/WorkspaceBoardToolbar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
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

describe('WorkspaceBoardToolbar', () => {
  beforeEach(() => {
    useChatLayoutStore.setState({ showFilesPanel: false, mobileSurface: 'chat' });
    useServerDataStore.setState({
      activeWorkspace: workspace,
      workspaces: [workspace],
      agents: [],
    });
  });

  test('places Sessions and Workbench controls at the header edges', () => {
    const { container, getByRole, queryByText } = render(
      <SidebarProvider panelId="sessions">
        <WorkspaceBoardToolbar />
      </SidebarProvider>,
    );

    const header = container.querySelector('[data-slot="primary-dock-header"]');
    const sessions = getByRole('button', { name: 'Hide Sessions' });
    const files = getByRole('button', { name: 'Show Files' });

    expect(queryByText('Session Board')).not.toBeInTheDocument();
    expect(header?.firstElementChild).toContainElement(sessions);
    expect(header?.lastElementChild).toContainElement(files);
  });

});
