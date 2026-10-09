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

test('duplicate workspace names have distinct selections and searchable paths', async () => {
  const user = userEvent.setup();
  const old: Workspace = { id: 'old', name: 'jean2', path: '/projects/archive', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' };
  const current: Workspace = { ...old, id: 'current', path: '/projects/current' };
  const select = vi.fn();
  render(<WorkspaceSwitcher selectionOnly workspaces={[old, current]} agents={[]} activeWorkspace={old} onSelectWorkspace={select} />);
  await user.click(screen.getByRole('combobox', { name: 'Select workspace' }));
  expect(screen.getByRole('option', { name: /archive/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /\/projects\/current/ })).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText('Search workspace...'), '/projects/current');
  expect(screen.queryByRole('option', { name: /archive/ })).not.toBeInTheDocument();
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'current', path: '/projects/current' }));
});

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

test('lists other machines\' workspaces and switches machines in one step', async () => {
  const user = userEvent.setup();
  const local: Workspace = { id: 'local', name: 'jean2', path: '/projects/jean2', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' };
  const remote: Workspace = { ...local, id: 'remote', name: 'website', path: '/srv/website' };
  const server = (id: string, name: string) => ({ id, name, url: `${id}.ts.net`, createdAt: '' });
  const onOpenChange = vi.fn();
  const selectHost = vi.fn();
  render(<WorkspaceSwitcher
    selectionOnly
    workspaces={[local]}
    agents={[]}
    activeWorkspace={local}
    onSelectWorkspace={vi.fn()}
    currentHostName="Studio"
    otherHosts={[
      { server: server('laptop', 'Laptop'), state: 'ready', workspaces: [remote] },
      { server: server('nas', 'NAS'), state: 'offline', workspaces: [] },
    ]}
    onSelectHostWorkspace={selectHost}
    onOpenChange={onOpenChange}
  />);

  await user.click(screen.getByRole('combobox', { name: 'Select workspace' }));
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(screen.getByText('Studio')).toBeInTheDocument();
  expect(screen.getByText('NAS · offline')).toBeInTheDocument();
  expect(screen.getByText('Not reachable right now.')).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText('Search workspace...'), 'laptop');
  expect(screen.queryByRole('option', { name: /jean2/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('option', { name: /website/ }));
  expect(selectHost).toHaveBeenCalledWith('laptop', remote);
});

test('offers pairing for a machine this device is not paired with', async () => {
  const user = userEvent.setup();
  const local: Workspace = { id: 'local', name: 'jean2', path: '/p', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' };
  const selectHost = vi.fn();
  render(<WorkspaceSwitcher selectionOnly workspaces={[local]} agents={[]} activeWorkspace={local} onSelectWorkspace={vi.fn()}
    otherHosts={[{ server: { id: 'office', name: 'Office', url: 'office', createdAt: '' }, state: 'unpaired', workspaces: [] }]}
    onSelectHostWorkspace={selectHost} />);
  await user.click(screen.getByRole('combobox', { name: 'Select workspace' }));
  await user.click(screen.getByRole('option', { name: /Pair this device/ }));
  expect(selectHost).toHaveBeenCalledWith('office', null);
});

test('a single machine keeps the plain Workspaces heading', async () => {
  const user = userEvent.setup();
  const local: Workspace = { id: 'local', name: 'jean2', path: '/p', isVirtual: false, additionalPaths: [], settings: {}, createdAt: '', updatedAt: '' };
  render(<WorkspaceSwitcher selectionOnly workspaces={[local]} agents={[]} activeWorkspace={local} onSelectWorkspace={vi.fn()} currentHostName="Studio" />);
  await user.click(screen.getByRole('combobox', { name: 'Select workspace' }));
  expect(screen.getByText('Workspaces')).toBeInTheDocument();
  expect(screen.queryByText('Studio')).not.toBeInTheDocument();
});
