import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { BranchesPanel } from '@/components/files/BranchesPanel';
const head = 'a'.repeat(40);
const other = 'b'.repeat(40);
const action = vi.fn();
const branches = vi.fn();
const client = { http: { files: { gitRebaseState: vi.fn(async () => ({ active: false, conflicts: [], token: null })), gitBranches: branches, gitBranchAction: action, gitHistory: vi.fn(async () => ({ commits: [], nextOffset: null })) } } } as unknown as ProkopaiClient;
function setup(localExists: boolean) {
  const local: Array<Record<string, unknown>> = [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: null, ahead: null, behind: null }];
  if (localExists) local.push({ ref: 'refs/heads/feature/x', name: 'feature/x', head: other, kind: 'local', current: false, checkedOut: false, upstream: 'refs/remotes/origin/feature/x', ahead: 0, behind: 0 });
  branches.mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: null }, branches: [...local, { ref: 'refs/remotes/origin/feature/x', name: 'origin/feature/x', head, kind: 'remote', current: false, checkedOut: false, upstream: null, ahead: null, behind: null }] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
}
async function selectRemoteBranch() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select branch history' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Select branch history' }));
  fireEvent.click(await screen.findByRole('option', { name: 'origin/feature/x' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Checkout' }));
}
beforeEach(() => { action.mockReset().mockResolvedValue({}); branches.mockReset(); });

test('checkout switches to an existing local branch without recreating it', async () => {
  setup(true);
  await selectRemoteBranch();
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'switch', name: 'feature/x', expectedBranch: 'main', expectedHead: head, targetHead: other, root: '/tree' }));
  expect(action).not.toHaveBeenCalledWith('ws', expect.objectContaining({ action: 'track' }));
});

test('checkout tracks first when no local branch exists', async () => {
  setup(false);
  await selectRemoteBranch();
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'track', remote: 'origin', branch: 'feature/x', name: 'feature/x', expectedHead: head, root: '/tree' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'switch', name: 'feature/x', expectedBranch: 'main', expectedHead: head, targetHead: head, root: '/tree' }));
});
