import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, SavedServer, Session } from '@prokopai/sdk';

const pool = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
const remoteClient = vi.hoisted(() => ({ name: 'laptop-client' }));
vi.mock('@/lib/hostClientPool', async () => {
  const { create } = await import('zustand');
  return {
    acquireHostClient: pool.acquire,
    releaseHostClient: pool.release,
    useHostClientStore: create(() => ({
      clients: { laptop: remoteClient },
      urls: { laptop: 'https://laptop.ts.net' },
      status: { laptop: 'connected' },
    })),
  };
});
vi.mock('@/lib/hostRoutes', () => ({ resolveHostUrl: async () => 'https://laptop.ts.net' }));

const servers: SavedServer[] = [{ id: 'laptop', name: 'Laptop', url: 'laptop:8742', token: 'pkd_l', createdAt: '' }];
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers }) }));

vi.mock('@/components/app/WorkspaceSessionView', async () => {
  const { useSessionManager } = await import('@/contexts/SessionManagerContext');
  const { useSdkClient } = await import('@/contexts/ServerClientContext');
  const { useScopedServerData, useHostScope } = await import('@/contexts/HostScopeContext');
  return {
    WorkspaceSessionView: ({ sessionId }: { sessionId: string }) => {
      const manager = useSessionManager();
      const client = useSdkClient() as unknown as { name: string } | null;
      const models = useScopedServerData((data) => data.models.map((model) => model.id).join(','));
      const scope = useHostScope();
      return <div>
        <span>pane {sessionId}</span>
        <span>manager {(manager.sdkClient as unknown as { name: string } | null)?.name}</span>
        <span>client {client?.name}</span>
        <span>models {models}</span>
        <span>machine {scope?.serverName}</span>
      </div>;
    },
  };
});

import { ForeignSessionView } from '@/components/app/ForeignSessionView';
import { SessionManagerContext } from '@/contexts/SessionManagerContext';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useServerDataStore } from '@/stores/serverDataStore';

beforeEach(() => {
  useForeignSessionsStore.setState({ byId: {} });
  useForeignSessionsStore.getState().add('laptop', { id: 'remote-1', workspaceId: 'w-remote', title: 'Deploy' } as Session);
  useServerDataStore.setState({ models: [{ id: 'studio-model' } as never] });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/workspaces')) return Response.json({ workspaces: [{ id: 'w-remote', name: 'site' }] });
    if (url.includes('/api/models')) return Response.json({ models: [{ id: 'laptop-model', runtimeStatus: { usable: true } }], defaultModel: 'laptop-model' });
    if (url.includes('/api/preconfigs')) return Response.json({ preconfigs: [] });
    if (url.includes('/api/prompts')) return Response.json({ prompts: [] });
    if (url.includes('/api/providers')) return Response.json({ providers: [] });
    if (url.includes('/api/agents')) return Response.json({ agents: [] });
    return Response.json({});
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('ForeignSessionView', () => {
  test('gives the pane the other machine\'s connection, data, and name, and holds the connection while mounted', async () => {
    const activeClient = { name: 'studio-client' } as unknown as ProkopaiClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <SessionManagerContext.Provider value={{ sdkClient: activeClient, serverUrl: 'studio' } as never}>
          <ForeignSessionView serverId="laptop" sessionId="remote-1" />
        </SessionManagerContext.Provider>
      </QueryClientProvider>,
    );

    expect(pool.acquire).toHaveBeenCalledWith(servers[0]);
    expect(screen.getByText('manager laptop-client')).toBeTruthy();
    expect(screen.getByText('client laptop-client')).toBeTruthy();
    expect(screen.getByText('machine Laptop')).toBeTruthy();
    expect(await screen.findByText('models laptop-model')).toBeTruthy();

    unmount();
    expect(pool.release).toHaveBeenCalledWith('laptop');
  });
});
