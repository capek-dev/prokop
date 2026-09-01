import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Workspace, PermissionGrant } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
}));

vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: (selector: (s: { preconfigs: unknown[] }) => unknown) => selector({ preconfigs: [] }),
}));

vi.mock('@/hooks/queries', () => ({
  useMcpStatusQuery: () => ({ data: undefined, isLoading: false }),
  useMcpConnect: () => ({ mutate: vi.fn() }),
  useMcpDisconnect: () => ({ mutate: vi.fn() }),
  useMcpStartAuth: () => ({ mutate: vi.fn() }),
}));

import { WorkspaceSettingsDialog } from '@/components/modals/WorkspaceSettingsDialog';

function makeWorkspace(overrides: Partial<Workspace['settings']> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Demo',
    path: '/tmp/demo',
    isVirtual: false,
    additionalPaths: [],
    settings: {
      memory: { enabled: false, permissionRisk: 'medium' },
      skills: { managementEnabled: false, permissionRisk: 'medium' },
      sessionSearch: { enabled: false, permissionRisk: 'medium', includeToolResults: false },
      workflow: { enabled: false },
      scheduling: { enabled: false, permissionRisk: 'medium' },
      autoApproveSeverity: 'low',
      preconfigs: { selectedIds: null, defaultId: null },
      ...overrides,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const props = {
  onOpenChange: vi.fn(),
  onSave: mocks.save,
  sdkClient: null,
  permissions: [] as PermissionGrant[],
  onRefreshPermissions: vi.fn(),
  onRevokePermission: vi.fn(),
  onRevokeAllPermissions: vi.fn(),
  onUpdateWorkspacePaths: vi.fn(),
};

describe('WorkspaceSettingsDialog', () => {
  beforeEach(() => {
    mocks.save.mockClear();
    props.onOpenChange.mockClear();
    props.onRefreshPermissions.mockClear();
  });

  test('requests current permissions when opened', async () => {
    render(
      <WorkspaceSettingsDialog
        {...props}
        open
        workspace={makeWorkspace()}
      />,
    );

    await waitFor(() => expect(props.onRefreshPermissions).toHaveBeenCalledOnce());
  });

  test('memory edits keep the footer across tab switches and gate Save on dirty', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSettingsDialog
        {...props}
        open
        workspace={makeWorkspace()}
      />,
    );

    // Open the Memory section from the desktop tab rail.
    await user.click(screen.getByRole('tab', { name: /memory/i }));

    const saveButton = await screen.findByRole('button', { name: /saved/i });
    expect(saveButton).toBeDisabled();

    // Toggle the enable switch: draft diverges from snapshot. The panel is
    // lazy-loaded, so wait for the switch to mount.
    await user.click(await screen.findByRole('switch', { name: /enable memory/i }));
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();

    // The footer survives switching to a non-form section and back:
    // edits are never orphaned without a save affordance.
    await user.click(screen.getByRole('tab', { name: /mcp servers/i }));
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /memory/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ memory: { enabled: true, permissionRisk: 'medium' } }),
      ),
    );
  });
});
