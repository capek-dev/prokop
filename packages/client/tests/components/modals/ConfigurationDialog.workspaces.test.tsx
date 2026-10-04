import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ProkopaiClient, type Preconfig, type Workspace } from '@prokopai/sdk';
import { ConfigurationDialog } from '@/components/modals/ConfigurationDialog';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

vi.mock('@/hooks/useServerUpdate', () => ({ useServerUpdate: () => '2.0.0' }));

function makeWorkspace(id: string, name: string, settings: Workspace['settings'] = {}): Workspace {
  return { id, name, path: `/projects/${name}`, isVirtual: false, additionalPaths: [`/extra/${id}`],
    settings: { autoApproveSeverity: 'low', ...settings }, createdAt: '', updatedAt: '' };
}

beforeEach(() => {
  const alpha = makeWorkspace('a', 'Alpha');
  const beta = makeWorkspace('b', 'Beta');
  useServerDataStore.setState({ workspaces: [alpha, beta], activeWorkspace: beta, agents: [],
    preconfigs: [{ id: 'general', name: 'General', mode: 'primary' },
      { id: 'explore', name: 'Explore', mode: 'subagent' }] as Preconfig[] });
  useUIStore.setState({ configurationSection: 'workspace-general' });
});
afterEach(() => { vi.restoreAllMocks(); });

function setup() {
  const client = new ProkopaiClient({ url: 'http://test.invalid' });
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true);
  const list = vi.spyOn(client.permissions, 'list').mockImplementation(() => {});
  const revokeAll = vi.spyOn(client.permissions, 'revokeAll').mockImplementation(() => {});
  const getMcpStatus = vi.spyOn(client.http.mcp, 'getStatus').mockResolvedValue({ status: {} });
  vi.spyOn(client.http.sessions, 'claudeCatalog').mockResolvedValue({ models: [] });
  vi.spyOn(client.http.sessions, 'codexCatalog').mockResolvedValue({ models: [] });
  const update = vi.spyOn(client.http.workspaces, 'update').mockImplementation(async (id, data) => ({
    workspace: { ...useServerDataStore.getState().workspaces.find(w => w.id === id)!, ...data },
  }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const close = vi.fn();
  const rendered = render(<QueryClientProvider client={cache}>
    <ServerClientProvider value={{ sdkClient: client, serverUrl: 'http://test.invalid', apiToken: null, connected: true }}>
    <ConfigurationDialog open onOpenChange={close} sdkClient={client} apiToken={null} isConnected onLogout={vi.fn()} />
    </ServerClientProvider>
  </QueryClientProvider>);
  return { ...rendered, client, list, revokeAll, update, getMcpStatus, close, user: userEvent.setup() };
}

async function section(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(within(screen.getByRole('group', { name: 'Workspace' })).getByRole('tab', { name: label }));
}
async function selectWorkspace(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('combobox', { name: 'Select workspace' }));
  expect(screen.queryByRole('option', { name: 'Create virtual workspace' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Workspace actions' })).not.toBeInTheDocument();
  await user.type(screen.getByPlaceholderText('Search workspace...'), name);
  await user.click(screen.getByRole('option', { name: new RegExp(name) }));
}

describe('workspaces in shared settings', () => {
  test.each(['workspace-general', 'workspace-sessions', 'workspace-paths'] as const)('opens General from %s with paths collapsed', async configurationSection => {
    useUIStore.setState({ configurationSection });
    setup();
    expect(await screen.findByRole('combobox', { name: 'Default agent' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Session order' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Additional Paths' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Additional paths/ })).toHaveTextContent('1 path');
    expect(screen.getByRole('button', { name: /^Additional paths/ })).toHaveAttribute('data-state', 'closed');
    expect(screen.queryByRole('button', { name: 'Remove /extra/b' })).not.toBeInTheDocument();
  });

  test('saves default agent, session order, and paths together after switching workspaces', async () => {
    const { user, update } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Default agent' }));
    await user.click(screen.getByRole('option', { name: 'General' }));
    await user.click(screen.getByRole('combobox', { name: 'Session order' }));
    await user.click(screen.getByRole('option', { name: 'Untagged first' }));
    await user.click(screen.getByRole('button', { name: /^Additional paths/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove /extra/b' }));
    expect(screen.getByRole('button', { name: /^Additional paths/ })).toHaveTextContent('0 paths');
    expect(screen.getByRole('button', { name: 'Add Path' })).toBeInTheDocument();
    await selectWorkspace(user, 'Alpha');
    expect(screen.getByRole('button', { name: /^Additional paths/ })).toHaveTextContent('1 path');
    expect(screen.getByRole('combobox', { name: 'Default agent' })).toHaveTextContent('Server default');
    await selectWorkspace(user, 'Beta');
    expect(screen.getByRole('button', { name: /^Additional paths/ })).toHaveTextContent('0 paths');
    expect(screen.getByRole('combobox', { name: 'Default agent' })).toHaveTextContent('General');
    expect(screen.getByRole('combobox', { name: 'Session order' })).toHaveTextContent('Untagged first');
    expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('b', {
      settings: expect.objectContaining({ sessionTagOrder: 'untagged-first',
        preconfigs: { defaultId: 'general', selectedIds: null } }),
      additionalPaths: [],
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
  });

  test('mobile navigation reaches General and its additional paths', async () => {
    useUIStore.setState({ configurationSection: 'appearance' });
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Settings section' }));
    await user.click(screen.getByRole('option', { name: 'General' }));
    expect(await screen.findByRole('combobox', { name: 'Default agent' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Additional paths/ }));
    expect(await screen.findByRole('button', { name: 'Remove /extra/b' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Path' })).toBeInTheDocument();
  });

  test.each(['workspace-learning', 'workspace-agentTools'] as const)('opens the merged page from %s', async configurationSection => {
    useUIStore.setState({ configurationSection });
    setup();
    expect(await screen.findByRole('switch', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Skill management' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Automatic learning' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Memory & Learning' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Agent Tools' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Learning' })).not.toBeInTheDocument();
  });

  test('saves learning and its memory and skill dependencies from the same page', async () => {
    useServerDataStore.setState(state => ({ workspaces: state.workspaces.map(workspace => ({
      ...workspace, settings: { ...workspace.settings, preconfigs: { defaultId: 'general', selectedIds: null } },
    })) }));
    const { user, update } = setup();
    await section(user, 'Memory & Learning');
    await user.click(await screen.findByRole('switch', { name: 'Automatic learning' }));
    expect(screen.getByRole('switch', { name: 'Memory' })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Improve skills' }));
    expect(screen.getByRole('switch', { name: 'Skill management' })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Use as personal learning source' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('b', expect.objectContaining({
      settings: expect.objectContaining({
        memory: { enabled: true, permissionRisk: 'none' },
        skills: { managementEnabled: true, permissionRisk: 'none' },
        learning: expect.objectContaining({ enabled: true, improveSkills: true,
          reviewers: [expect.objectContaining({ preconfigId: 'general' })] }),
        allowPersonalLearning: false,
      }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    await user.click(screen.getByRole('switch', { name: 'Memory' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith('b', expect.objectContaining({
      settings: expect.objectContaining({ learning: expect.objectContaining({ enabled: false }) }),
    })));
  });

  test('defaults to the opening workspace and keeps a single settings dialog', async () => {
    const { list } = setup();
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Beta');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(screen.getByRole('group', { name: 'Workspace' })).queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Set the default agent, session order, and additional paths for the selected workspace.')).toBeInTheDocument();
    await waitFor(() => expect(list).toHaveBeenCalledWith('b', true));
    expect(within(screen.getByRole('group', { name: 'Workspace' })).getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('combobox', { name: 'Workspace settings section' })).not.toBeInTheDocument();
    expect(screen.getByText('prokop update')).toBeInTheDocument();
  });

  test('captures the opening workspace even if the active workspace later changes', async () => {
    useUIStore.setState({ configurationSection: 'mcp' });
    const { user } = setup();
    act(() => useServerDataStore.getState().setActiveWorkspace(useServerDataStore.getState().workspaces[0]!));
    await section(user, 'General');
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Beta');
    await selectWorkspace(user, 'Alpha');
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Alpha');
  });

  test('searches and switches settings without changing the active chat workspace', async () => {
    const { user, list, update, close } = setup();
    await selectWorkspace(user, 'Alpha');
    expect(useServerDataStore.getState().activeWorkspace?.id).toBe('b');
    expect(list).toHaveBeenLastCalledWith('a', true);
    await user.click(screen.getByRole('combobox', { name: 'Session order' }));
    await user.click(screen.getByRole('option', { name: 'Untagged first' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('a', expect.objectContaining({
      settings: expect.objectContaining({ sessionTagOrder: 'untagged-first', autoApproveSeverity: 'low' }),
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(close).not.toHaveBeenCalled();
    expect(useServerDataStore.getState().activeWorkspace?.id).toBe('b');
  });

  test('keeps drafts isolated across workspace and section switches', async () => {
    const { user, update } = setup();
    await section(user, 'Memory & Learning');
    expect(screen.getByText('Manage shared memory, skills, and learning for the selected workspace.')).toBeInTheDocument();
    await user.click(await screen.findByRole('switch', { name: 'Memory' }));
    await section(user, 'MCP Servers');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await user.click(within(screen.getByRole('tablist', { name: 'Server' })).getByRole('tab', { name: 'MCP Servers' }));
    await section(user, 'General');
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeEnabled();
    await selectWorkspace(user, 'Alpha');
    await section(user, 'Memory & Learning');
    expect(await screen.findByRole('switch', { name: 'Memory' })).not.toBeChecked();
    await selectWorkspace(user, 'Beta');
    await section(user, 'Memory & Learning');
    expect(await screen.findByRole('switch', { name: 'Memory' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('b', expect.objectContaining({
      settings: expect.objectContaining({ memory: { enabled: true, permissionRisk: 'none' } }),
    })));
  });

  test('keeps a failed save editable and retries without closing the modal', async () => {
    const { user, update, close } = setup();
    update.mockRejectedValueOnce(new Error('Save failed'));
    await section(user, 'Memory & Learning');
    await user.click(await screen.findByRole('switch', { name: 'Memory' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('switch', { name: 'Memory' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled());
    expect(close).not.toHaveBeenCalled();
  });

  test('a late save preserves newer edits and another workspace draft', async () => {
    const { user, update } = setup();
    let finish: (result: { workspace: Workspace }) => void = () => {};
    update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await section(user, 'Memory & Learning');
    await user.click(await screen.findByRole('switch', { name: 'Memory' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    // A second edit while the first request is running must remain unsaved.
    await user.click(screen.getByRole('switch', { name: 'Memory' }));
    await selectWorkspace(user, 'Alpha');
    await section(user, 'General');
    await user.click(screen.getByRole('combobox', { name: 'Session order' }));
    await user.click(screen.getByRole('option', { name: 'Untagged first' }));
    const savedBeta = { ...useServerDataStore.getState().workspaces[1]!, ...update.mock.calls[0]![1] };
    await act(async () => { finish({ workspace: savedBeta }); });
    expect(screen.getByRole('combobox', { name: 'Session order' })).toHaveTextContent('Untagged first');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await selectWorkspace(user, 'Beta');
    await section(user, 'Memory & Learning');
    expect(await screen.findByRole('switch', { name: 'Memory' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  test('reopening settings starts from the current chat workspace', async () => {
    const first = setup();
    await selectWorkspace(first.user, 'Alpha');
    first.unmount();
    setup();
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Beta');
  });

  test('updates paths and permission mode on the selected workspace', async () => {
    const { user, update } = setup();
    await selectWorkspace(user, 'Alpha');
    await section(user, 'General');
    await user.click(screen.getByRole('button', { name: /^Additional paths/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove /extra/a' }));
    await section(user, 'Permissions');
    await user.click(await screen.findByRole('combobox', { name: 'Default permission mode' }));
    await user.click(screen.getByRole('option', { name: 'Extended' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('a', { settings: expect.objectContaining({ permissionMode: 'extended' }) }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith('a', {
      settings: expect.objectContaining({ permissionMode: 'extended' }), additionalPaths: [],
    }));
  });

  test('uses the selected workspace for MCP and preserves default-agent filtering', async () => {
    const { user, getMcpStatus, update } = setup();
    await selectWorkspace(user, 'Alpha');
    await section(user, 'MCP Servers');
    await waitFor(() => expect(getMcpStatus).toHaveBeenCalledWith('a', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await section(user, 'General');
    await user.click(screen.getByRole('combobox', { name: 'Default agent' }));
    expect(screen.queryByRole('option', { name: 'Explore' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'General' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('a', expect.objectContaining({
      settings: expect.objectContaining({ preconfigs: { selectedIds: null, defaultId: 'general' } }),
    })));
  });

  test('agent homes keep their settings but hide workspace learning', async () => {
    useServerDataStore.setState({ workspaces: [makeWorkspace('home', 'Agent home', { isAgentHome: true, agentId: 'general' })],
      agents: [{ id: 'general', name: 'General' }] as ReturnType<typeof useServerDataStore.getState>['agents'] });
    const { user } = setup();
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('General');
    await section(user, 'Memory & Learning');
    expect(await screen.findByRole('switch', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Automatic learning' })).not.toBeInTheDocument();
    expect(screen.getByText(/Configure this agent's personal learning in Agents/)).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Learning' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Memory & Learning' })).toBeInTheDocument();
  });

  test('handles no workspaces and removal of the selected workspace', async () => {
    setup();
    act(() => useServerDataStore.setState({ workspaces: [useServerDataStore.getState().workspaces[0]!] }));
    expect(await screen.findByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Alpha');
    act(() => useServerDataStore.setState({ workspaces: [], activeWorkspace: null }));
    expect(screen.getByText(/No workspaces on this server yet/)).toBeInTheDocument();
  });

  test('retains the merged page when switching to an agent home and hides workspace learning', async () => {
    const home = makeWorkspace('home', 'Agent home', { isAgentHome: true, agentId: 'general' });
    useServerDataStore.setState(state => ({ workspaces: [...state.workspaces, home],
      agents: [{ id: 'general', name: 'General' }] as typeof state.agents }));
    const { user } = setup();
    await section(user, 'Memory & Learning');
    expect(await screen.findByRole('switch', { name: 'Automatic learning' })).toBeInTheDocument();
    await selectWorkspace(user, 'General');
    expect(screen.queryByRole('tab', { name: 'Learning' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Memory & Learning' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('switch', { name: 'Memory' })).toBeInTheDocument();
    await selectWorkspace(user, 'Alpha');
    expect(await screen.findByRole('switch', { name: 'Automatic learning' })).toBeInTheDocument();
  });

  test('mobile navigation selects workspace pages and exposes their workspace picker', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('combobox', { name: 'Settings section' }));
    await user.click(screen.getByRole('option', { name: 'Memory & Learning' }));
    expect(await screen.findByRole('switch', { name: 'Memory' })).toBeInTheDocument();
    const context = within(screen.getByRole('group', { name: 'Workspace settings scope' }));
    await user.click(context.getByRole('combobox', { name: 'Select workspace' }));
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(context.getByRole('combobox', { name: 'Select workspace' })).toHaveTextContent('Alpha');
    expect(useServerDataStore.getState().activeWorkspace?.id).toBe('b');
  });
});
