import { useQueries } from '@tanstack/react-query';
import { AuthError, HttpClient, HttpNamespace, type SavedServer, type Workspace } from '@prokopai/sdk';
import { resolveHostUrl } from '@/lib/hostRoutes';
import { isAgentHomeWorkspace } from '@/lib/workspaceKind';

export type HostWorkspacesState = 'loading' | 'ready' | 'offline' | 'unpaired';

export interface HostWorkspaces {
  server: SavedServer;
  state: HostWorkspacesState;
  /** Last known list; kept while the host is offline. */
  workspaces: Workspace[];
}

class UnpairedHostError extends Error {}

async function fetchHostWorkspaces(server: SavedServer, signal: AbortSignal): Promise<Workspace[]> {
  const url = await resolveHostUrl(server, signal);
  const http = new HttpNamespace(new HttpClient({ url, ...(server.token ? { token: server.token } : {}) }));
  try {
    const { workspaces } = await http.workspaces.list({ signal });
    return workspaces.filter((workspace) => !isAgentHomeWorkspace(workspace));
  } catch (error: unknown) {
    if (error instanceof AuthError) throw new UnpairedHostError(error.message);
    throw error;
  }
}

/**
 * Workspaces on every other saved machine, for the unified workspace switcher.
 * Fetched when `enabled` (the switcher is open) and cached, so an offline
 * machine still lists what it had. The active machine is excluded: its live
 * list comes from the connection.
 */
export function useHostWorkspaces(servers: SavedServer[], activeServerId: string | null, enabled: boolean): HostWorkspaces[] {
  const others = servers.filter((server) => server.id !== activeServerId);
  const results = useQueries({
    queries: others.map((server) => ({
      queryKey: ['host-workspaces', server.id, server.token ?? null] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchHostWorkspaces(server, signal),
      enabled,
      staleTime: 30_000,
      gcTime: Infinity,
      retry: false,
    })),
  });
  return others.map((server, index) => {
    const result = results[index]!;
    const workspaces = result.data ?? [];
    const state: HostWorkspacesState = result.error instanceof UnpairedHostError ? 'unpaired'
      : result.isError ? 'offline'
        : result.data ? 'ready'
          : 'loading';
    return { server, state, workspaces };
  });
}
