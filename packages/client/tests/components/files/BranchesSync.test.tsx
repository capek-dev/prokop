import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { BranchesPanel } from '@/components/files/BranchesPanel';
const head = 'a'.repeat(40);
const action = vi.fn();
const branches = vi.fn();
const gitHistory = vi.fn();
const client = { http: { files: { gitRebaseState: vi.fn(async () => ({ active: false, conflicts: [], token: null })), gitBranches: branches, gitBranchAction: action, gitHistory } } } as unknown as ProkopaiClient;
beforeEach(() => {
  action.mockReset().mockResolvedValue({});
  branches.mockReset().mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: { remote: 'origin', branch: 'main' } }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: 'refs/remotes/origin/main', ahead: 1, behind: 1 }] });
  gitHistory.mockReset();
});
test('history marks pushable commits green and remote-only commits yellow', async () => {
  gitHistory.mockResolvedValue({ commits: [
    { head: 'b'.repeat(40), subject: 'Local work', author: 'Test', date: '2026-01-02T00:00:00Z', sync: 'ahead' },
    { head: 'c'.repeat(40), subject: 'Remote work', author: 'Test', date: '2026-01-01T00:00:00Z', sync: 'behind' },
    { head, subject: 'Shared', author: 'Test', date: '2025-12-31T00:00:00Z' },
  ], nextOffset: null });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
  await screen.findByText('Local work');
  expect(gitHistory).toHaveBeenCalledWith('ws', { root: '/tree', head, offset: 0, upstream: 'refs/remotes/origin/main' });
  expect(screen.getByTitle('Not on upstream yet — push to publish')).toBeInTheDocument();
  expect(screen.getByTitle('On upstream only — pull to get')).toBeInTheDocument();
  expect(screen.getByText('Shared')).toBeInTheDocument();
});
test('history without upstream requests the plain walk', async () => {
  branches.mockResolvedValue({ repository: { branch: 'main', head, remotes: [], upstream: null }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: null, ahead: null, behind: null }] });
  gitHistory.mockResolvedValue({ commits: [], nextOffset: null });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
  await screen.findByText('No commits.');
  expect(gitHistory).toHaveBeenCalledWith('ws', { root: '/tree', head, offset: 0, upstream: null });
});
