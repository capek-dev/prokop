import { useEffect, useMemo } from 'react';
import { WorkspaceSessionView } from '@/components/app/WorkspaceSessionView';
import { useServerContext } from '@/contexts/ServerContext';
import { SessionManagerContext, useSessionManager } from '@/contexts/SessionManagerContext';
import { HostScopeProvider, useHostServerData, useSessionById } from '@/contexts/HostScopeContext';
import { acquireHostClient, releaseHostClient, useHostClientStore } from '@/lib/hostClientPool';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

/**
 * A session from another machine, shown on this board. Holds that machine's
 * pooled connection while the tab exists and scopes the pane's client and
 * server data to that machine.
 */
export function ForeignSessionView({ serverId, sessionId }: { serverId: string; sessionId: string }) {
  const { servers } = useServerContext();
  const server = servers.find((candidate) => candidate.id === serverId);
  const session = useSessionById(sessionId);
  const client = useHostClientStore((state) => state.clients[serverId] ?? null);
  const url = useHostClientStore((state) => state.urls[serverId] ?? null);
  const status = useHostClientStore((state) => state.status[serverId]);
  const data = useHostServerData(server, session?.workspaceId ?? null);
  const parent = useSessionManager();
  const manager = useMemo(() => ({ ...parent, sdkClient: client, serverUrl: url }), [parent, client, url]);
  const serverClient = useMemo(
    () => ({ sdkClient: client, serverUrl: url, apiToken: server?.token ?? null, connected: status === 'connected' }),
    [client, url, server?.token, status],
  );

  useEffect(() => {
    if (!server) return;
    acquireHostClient(server);
    return () => releaseHostClient(server.id);
    // Reconnect only when the connection details change, not on every server list update.
  }, [server?.id, server?.url, server?.token]);

  if (!server) {
    return <p className="p-6 text-sm text-muted-foreground">This machine is no longer saved on this device. Close the tab.</p>;
  }
  if (status === 'unpaired') {
    return <p className="p-6 text-sm text-muted-foreground">This device is not paired with {server.name}. Open {server.name} once to pair it.</p>;
  }

  return (
    <HostScopeProvider value={{ serverId, serverName: server.name, data }}>
      <SessionManagerContext.Provider value={manager}>
        <ServerClientProvider value={serverClient}>
          <WorkspaceSessionView sessionId={sessionId} sdkClient={client} serverUrl={url} />
        </ServerClientProvider>
      </SessionManagerContext.Provider>
    </HostScopeProvider>
  );
}
