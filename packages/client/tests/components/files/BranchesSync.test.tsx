import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { BranchesPanel } from '@/components/files/BranchesPanel';
const head = 'a'.repeat(40);
const action = vi.fn();
const branches = vi.fn();
const gitHistory = vi.fn();
const gitBranchPushReview = vi.fn();
const client = { http: { files: { gitRebaseState: vi.fn(async () => ({ active: false, conflicts: [], token: null })), gitBranches: branches, gitBranchAction: action, gitHistory, gitBranchPushReview } } } as unknown as ProkopaiClient;
beforeEach(() => {
  action.mockReset().mockResolvedValue({});
  branches.mockReset().mockResolvedValue({ repository: { branch: 'main', head, remotes: ['origin'], upstream: { remote: 'origin', branch: 'main' } }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: 'refs/remotes/origin/main', ahead: 1, behind: 1 }] });
  gitHistory.mockReset();
  gitBranchPushReview.mockReset();
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
test('successful push refreshes sync markers when head and upstream name stay unchanged', async () => {
  const entry = { head, subject: 'Local work', author: 'Test', date: '2026-01-02T00:00:00Z' };
  gitHistory.mockResolvedValue({ commits: [{ ...entry, sync: 'ahead' }], nextOffset: null });
  gitBranchPushReview.mockResolvedValue({ remoteHead: 'b'.repeat(40), outgoingCount: 1, remoteOnlyCount: 0, outgoing: [entry], remoteOnly: [] });
  action.mockImplementation(async () => {
    gitHistory.mockResolvedValue({ commits: [entry], nextOffset: null });
    return {};
  });
  // A fresh cache must still be invalidated, even while the push panel hides history.
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(<QueryClientProvider client={cache}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
  await screen.findByText('Local work');
  expect(screen.getByTitle(/Not on upstream yet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Push…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review push' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Push commits' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: 'Push…' });
  await waitFor(() => expect(gitHistory).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByTitle(/Not on upstream yet/)).not.toBeInTheDocument());
  expect(screen.getByText('Local work')).toBeInTheDocument();
});

test.each(['success', 'failure', 'success-away', 'failure-away', 'warning-away'])('push survives session remount: %s', async (outcome) => {
  let resolvePush!: (result: { warning?: string }) => void;
  let rejectPush!: (error: Error) => void;
  action.mockImplementation(() => new Promise<{ warning?: string }>((resolve, reject) => {
    resolvePush = resolve;
    rejectPush = reject;
  }));
  gitHistory.mockResolvedValue({ commits: [], nextOffset: null });
  gitBranchPushReview.mockResolvedValue({ remoteHead: 'b'.repeat(40), outgoingCount: 1, remoteOnlyCount: 0, outgoing: [], remoteOnly: [] });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const panel = (serverId = 'server', workspaceId = 'ws', root = '/tree') => <QueryClientProvider client={cache}><BranchesPanel key={`${serverId}:${workspaceId}:${root}`} sdkClient={client} workspaceId={workspaceId} serverId={serverId} root={root} /></QueryClientProvider>;
  const view = render(panel());
  fireEvent.click(await screen.findByRole('button', { name: 'Push…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review push' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Push commits' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Pushing main to origin/main');

  for (const scope of [['other', 'ws', '/tree'], ['server', 'other', '/tree'], ['server', 'ws', '/linked']]) {
    view.rerender(panel(...scope));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Push…' })).toBeEnabled());
  }
  view.rerender(panel());
  expect(await screen.findByRole('status')).toHaveTextContent('pre-push hooks');
  expect(screen.getByRole('button', { name: 'Push…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Push…' }));
  expect(action).toHaveBeenCalledTimes(1);

  if (outcome.endsWith('-away')) view.rerender(<QueryClientProvider client={cache}><div>Other session</div></QueryClientProvider>);
  if (outcome.startsWith('failure')) rejectPush(new Error('Pre-push hook rejected'));
  else resolvePush(outcome === 'warning-away' ? { warning: 'Push succeeded, upstream setup failed' } : {});
  await waitFor(() => expect(cache.isMutating()).toBe(0));
  view.rerender(panel());
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Push…' })).toBeEnabled());
  if (outcome.startsWith('failure')) expect(await screen.findByRole('alert')).toHaveTextContent('Pre-push hook rejected');
  else if (outcome === 'warning-away') expect(await screen.findByRole('alert')).toHaveTextContent('upstream setup failed');
  else expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(action).toHaveBeenCalledTimes(1);
  view.unmount();
  cache.clear();
});

test('history without upstream requests the plain walk', async () => {
  branches.mockResolvedValue({ repository: { branch: 'main', head, remotes: [], upstream: null }, branches: [{ ref: 'refs/heads/main', name: 'main', head, kind: 'local', current: true, checkedOut: true, upstream: null, ahead: null, behind: null }] });
  gitHistory.mockResolvedValue({ commits: [], nextOffset: null });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><BranchesPanel sdkClient={client} workspaceId="ws" serverId="server" root="/tree" /></QueryClientProvider>);
  await screen.findByText('No commits.');
  expect(gitHistory).toHaveBeenCalledWith('ws', { root: '/tree', head, offset: 0, upstream: null });
});
