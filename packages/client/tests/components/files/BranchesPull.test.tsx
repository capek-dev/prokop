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
async function browseMain(upstream: string | null, checkedOut = false) {
  branches.mockResolvedValue({ repository: { branch: 'dev', head: 'b'.repeat(40), remotes: ['origin'], upstream: null }, branches: [
    { ref: 'refs/heads/dev', name: 'dev', head: 'b'.repeat(40), kind: 'local', current: true, checkedOut: true, upstream: null },
    { ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: false, checkedOut, upstream },
  ] });
  setup();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select branch history' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Select branch history' }));
  fireEvent.click(await screen.findByRole('option', { name: checkedOut ? 'main In use' : 'main' }));
}

test('Pull updates browsed main without switching away from dev', async () => {
  await browseMain('refs/remotes/origin/main');
  fireEvent.click(screen.getByRole('button', { name: 'Pull' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith('ws', { action: 'pull-branch', name: 'main', expectedHead: head, root: '/tree' }));
  expect(action).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'View checked-out branch dev' })).toBeInTheDocument();
});

test.each([null, 'refs/heads/dev'])('Pull is disabled for a browsed branch without remote upstream: %s', async (upstream) => {
  await browseMain(upstream);
  expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});

test('Pull is disabled for a branch checked out in another worktree', async () => {
  await browseMain('refs/remotes/origin/main', true);
  expect(screen.getByRole('button', { name: 'Pull' })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});

test('Pull is disabled without upstream', async () => {
  branches.mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: null }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true }] });
  setup();
  expect(await screen.findByRole('button', { name: 'Pull' })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});
