import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { Agent, Workspace } from '@prokopai/sdk';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';

vi.mock('@/components/modals/FolderPickerDialog', () => ({
  FolderPickerDialog: () => null,
}));
vi.mock('@/components/modals/WorkspaceAdditionalPathsDialog', () => ({
  WorkspaceAdditionalPathsDialog: () => null,
}));

afterEach(cleanup);

test('removes a deleted agent home from an open selector while preserving workspace selection', async () => {
  const user = userEvent.setup();
  const project: Workspace = {
    id: 'project', name: 'Project', path: '/project', isVirtual: false,
    additionalPaths: [], settings: {}, createdAt: '', updatedAt: '',
  };
  const home: Workspace = {
    ...project, id: 'home', name: 'Coder home', path: '/home',
    settings: { isAgentHome: true, agentId: 'coder' },
  };
  const agent: Agent = {
    id: 'coder', name: 'Coder', description: '', systemPrompt: '',
    tools: null, model: null, provider: null, settings: null,
    isDefault: false, hasHome: true, createdAt: '',
  };
  const props: ComponentProps<typeof WorkspaceSwitcher> = {
    workspaces: [project, home], agents: [agent], activeWorkspace: home,
    onSelectWorkspace: vi.fn(), onCreateVirtualWorkspace: vi.fn(),
    onCreatePhysicalWorkspace: vi.fn(), onDeleteWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(), onUpdateWorkspacePath: vi.fn(),
    onUpdateWorkspacePaths: vi.fn(), sdkClient: null,
  };
  const { rerender } = render(<WorkspaceSwitcher {...props} />);
  await user.click(screen.getByRole('combobox', { name: 'Select workspace' }));
  expect(screen.getByRole('option', { name: 'Coder' })).toBeInTheDocument();

  rerender(<WorkspaceSwitcher {...props} agents={[]} />);

  expect(screen.queryByRole('option', { name: /Coder/ })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Coder home');
  expect(props.onDeleteWorkspace).not.toHaveBeenCalled();
  expect(props.onSelectWorkspace).not.toHaveBeenCalled();
  await user.click(screen.getByRole('option', { name: /Project/ }));
  expect(props.onSelectWorkspace).toHaveBeenCalledWith(expect.objectContaining(project));
});
