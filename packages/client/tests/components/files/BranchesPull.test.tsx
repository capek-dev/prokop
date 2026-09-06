import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { BranchesPanel } from '@/components/files/BranchesPanel';
const head = 'a'.repeat(40);
const action = vi.fn();
const branches = vi.fn();
const client = { http: { files: { gitRebaseState: vi.fn(async () => ({ active: false, conflicts: [], token: null })), gitBranches: branches, gitBranchAction: action, gitHistory: vi.fn(async () => ({ commits: [], nextOffset: null })) } } } as unknown as ProkopaiClient;
beforeEach(() => {
  action.mockReset().mockResolvedValue({});
  branches.mockReset().mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: { remote: 'origin', branch: 'main' } }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: 'refs/remotes/origin/main', ahead: 0, behind: 1 }] });
});
function setup() { render(<QueryClientProvider client={new QueryClient()}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>); }
test('Pull sends the checked-out branch and upstream with the selected root', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Pull' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'pull', expectedBranch: 'main', expectedHead: head, remote: 'origin', branch: 'main', root: '/tree' }));
});
test('Pull is disabled without upstream', async () => {
  branches.mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: null }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true }] });
  setup();
  expect(await screen.findByRole('button', { name: 'Pull' })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});
