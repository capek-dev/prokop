import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { McpServerConfig, ProkopaiClient } from '@prokopai/sdk';
import { MCPServersPanel } from '@/components/modals/configuration/MCPServersPanel';
import { queryKeys } from '@/lib/queryKeys';

afterEach(() => { vi.restoreAllMocks(); });
function setup(initial: Record<string, { config: McpServerConfig; status: { status: 'connected' | 'disabled' | 'needs_auth' } }> = {}) {
  const servers: Record<string, { config: McpServerConfig; status: { status: 'connected' | 'disabled' | 'needs_auth' } }> = { ...initial };
  let enabled = true;
  const api = {
    getStatus: vi.fn(async () => ({ status: { ...servers } })),
    save: vi.fn(async (workspace: string, name: string, config: McpServerConfig) => {
      servers[name] = { config, status: { status: config.enabled === false ? 'disabled' : 'connected' } };
      return { success: true };
    }),
    remove: vi.fn(async (_workspace: string, name: string) => { delete servers[name]; return { success: true }; }),
    getTools: vi.fn(async () => ({ tools: [{ name: 'write_records', description: 'Update records', enabled }] })),
    setToolEnabled: vi.fn(async (_workspace: string, _name: string, _tool: string, value: boolean) => { enabled = value; return { success: true }; }),
    connect: vi.fn(async () => ({ status: { status: 'connected' } })),
    startAuth: vi.fn(async (_workspace: string, name: string) => {
      servers[name]!.status = { status: 'needs_auth' };
      return { authorizationUrl: 'https://crm.example/authorize?state=abc' };
    }),
  };
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><MCPServersPanel workspaceId="ws" sdkClient={{ http: { mcp: api } } as unknown as ProkopaiClient} /></QueryClientProvider>);
  return { api, cache, servers, user: userEvent.setup() };
}
describe('MCP workspace settings', () => {
  test('adds a remote server without editing a file', async () => {
    const { api, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    await user.type(screen.getByLabelText('Name'), 'CRM');
    await user.type(screen.getByLabelText('MCP server URL'), 'https://crm.example/mcp');
    await user.click(screen.getByRole('button', { name: 'Save server' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('ws', 'CRM', expect.objectContaining({ type: 'remote', url: 'https://crm.example/mcp', oauth: {} })));
    expect(await screen.findByText('CRM')).toBeInTheDocument();
  });
  test('persists individual tool access and keeps the tool visible when denied', async () => {
    const { api, user } = setup({ CRM: { config: { type: 'remote', url: 'https://crm.example/mcp' }, status: { status: 'connected' } } });
    await user.click(await screen.findByRole('button', { name: 'Choose tools' }));
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    const toggle = await screen.findByRole('switch', { name: 'Allow write_records' });
    await user.click(toggle);
    await waitFor(() => expect(api.setToolEnabled).toHaveBeenCalledWith('ws', 'CRM', 'write_records', false));
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(screen.getByText('write_records')).toBeInTheDocument();
  });
  test('keeps disabled servers visible and lets users enable and remove them', async () => {
    const { api, user } = setup({ CRM: { config: { type: 'remote', url: 'https://crm.example/mcp', enabled: false }, status: { status: 'disabled' } } });
    const enable = await screen.findByRole('switch', { name: 'Enable CRM' });
    expect(enable).not.toBeChecked();
    await user.click(enable);
    await waitFor(() => expect(api.save).toHaveBeenCalledWith('ws', 'CRM', expect.objectContaining({ enabled: true })));
    await waitFor(() => expect(enable).toBeChecked());
    await user.click(screen.getByRole('button', { name: 'Remove CRM' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('ws', 'CRM'));
    expect(await screen.findByText(/No MCP servers yet/)).toBeInTheDocument();
  });
  test('provides a blocked-popup fallback and removes sign-in controls after OAuth completes', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { api, cache, servers, user } = setup({ CRM: { config: { type: 'remote', url: 'https://crm.example/mcp' }, status: { status: 'needs_auth' } } });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('link', { name: 'Continue sign-in' })).toHaveAttribute('href', 'https://crm.example/authorize?state=abc');
    expect(api.startAuth).toHaveBeenCalledWith('ws', 'CRM');
    // The mcp.changed handler invalidates this query after the OAuth callback.
    servers.CRM = { ...servers.CRM!, status: { status: 'connected' } };
    await act(async () => { await cache.invalidateQueries({ queryKey: queryKeys.mcp.status('ws') }); });
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue sign-in' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose tools' })).toBeInTheDocument();

    servers.CRM = { ...servers.CRM!, status: { status: 'needs_auth' } };
    await act(async () => { await cache.invalidateQueries({ queryKey: queryKeys.mcp.status('ws') }); });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});
