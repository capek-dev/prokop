import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient, Workspace } from '@prokopai/sdk';
import { PullRequestsView } from '@/components/pullRequests/PullRequestsView';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

const workspace: Workspace = {
  id: 'old',
  name: 'jean2',
  path: '/projects/archive',
  isVirtual: false,
  additionalPaths: [],
  settings: {},
  createdAt: '',
  updatedAt: '',
};
const discover = vi.fn();
const list = vi.fn();
const client = {
  http: { workspaces: { listWorktrees: async () => ({ worktrees: [] }) }, pullRequests: { discover, list } },
} as unknown as ProkopaiClient;

beforeEach(() => {
  discover.mockReset().mockResolvedValue({ connections: [], branch: 'main' });
  list.mockReset().mockResolvedValue({ items: [], nextPage: null, accountId: 'viewer' });
  useServerDataStore.setState({ workspaces: [workspace], activeWorkspace: workspace });
  useSessionStore.setState({ sessions: [] });
  useSessionBoardStore.setState({ focusedSessionId: null });
});
afterEach(() => {
  cleanup();
  useServerDataStore.setState({ workspaces: [], activeWorkspace: null });
});

test('empty discovery identifies the checkout and gives a visible refresh outcome', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PullRequestsView client={client} serverId="server" workspaceId="old" />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText('No GitHub or Azure DevOps remote was found in this checkout.'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Checkout path')).toHaveTextContent('/projects/archive');
  expect(screen.queryByRole('combobox', { name: 'Repository' })).not.toBeInTheDocument();
  let finish!: (data: unknown) => void;
  discover.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Rescan CLI connections' }));
  expect(await screen.findByText('Checking repositories…')).toBeInTheDocument();
  await waitFor(() => expect(discover).toHaveBeenCalledTimes(2));
  finish({ connections: [], branch: 'main' });
  expect(
    await screen.findByText('No GitHub or Azure DevOps remote was found in this checkout.'),
  ).toBeInTheDocument();
});

test('switching to a same-named workspace discovers its own repository', async () => {
  const cache = new QueryClient();
  const view = (id: string) => (
    <QueryClientProvider client={cache}>
      <PullRequestsView key={id} client={client} serverId="server" workspaceId={id} />
    </QueryClientProvider>
  );
  const { rerender } = render(view('old'));
  await screen.findByText('No GitHub or Azure DevOps remote was found in this checkout.');
  const current: Workspace = { ...workspace, id: 'current', path: '/projects/current' };
  useServerDataStore.setState({ workspaces: [workspace, current], activeWorkspace: current });
  discover.mockResolvedValue({
    branch: 'main',
    connections: [
      {
        status: 'connected',
        accountId: 'viewer',
        accountName: 'Reviewer',
        repository: {
          provider: 'github',
          host: 'github.com',
          owner: 'rabbyte-tech',
          name: 'jean2',
          remote: 'origin',
          key: 'github:rabbyte-tech/jean2',
          url: 'https://github.com/rabbyte-tech/jean2',
        },
      },
    ],
  });
  rerender(view('current'));
  expect(await screen.findByRole('combobox', { name: 'Repository' })).toHaveTextContent(
    'GitHub · rabbyte-tech/jean2 (origin)',
  );
  expect(screen.getByLabelText('Checkout path')).toHaveTextContent('/projects/current');
  expect(discover).toHaveBeenLastCalledWith('current', undefined);
  await waitFor(() =>
    expect(list).toHaveBeenCalledWith(
      'current',
      expect.objectContaining({ remote: 'origin', repositoryKey: 'github:rabbyte-tech/jean2' }),
      'open',
      1,
    ),
  );
});

test('an unavailable Azure connection shows the exact sign-in command from the server', async () => {
  discover.mockResolvedValue({
    branch: 'main',
    connections: [
      {
        status: 'unavailable',
        message: 'Azure CLI needs a sign-in for the tenant that owns "acme".',
        command: 'az login --tenant 479b24df-2b4c-4c28-9ced-2eebf82e9ab8 --allow-no-subscriptions',
        repository: {
          provider: 'azure',
          host: 'dev.azure.com',
          owner: 'acme',
          project: 'Product',
          name: 'App',
          remote: 'origin',
          key: 'azure:acme/product/app',
          url: 'https://dev.azure.com/acme/Product/_git/App',
        },
      },
    ],
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PullRequestsView client={client} serverId="server" workspaceId="old" />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText('az login --tenant 479b24df-2b4c-4c28-9ced-2eebf82e9ab8 --allow-no-subscriptions'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy command' })).toBeInTheDocument();
  expect(list).not.toHaveBeenCalled();
});
