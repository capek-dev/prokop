import { createFileRoute, Link, redirect, useParams, useRouter } from '@tanstack/react-router';
import { AuthError } from '@prokopai/sdk';
import { PairDeviceScreen } from '@/components/PairDeviceScreen';
import { useServerContext } from '@/contexts/ServerContext';
import { fetchCriticalServerData, type CriticalServerData } from '@/lib/fetchServerData';
import { StoreHydrator } from '@/components/providers/StoreHydrator';
import ServerShell from '@/components/shell/ServerShell';
import { setLastSelectedServerId } from '@/config/servers';
import { mark } from '@/lib/perf';
import { retryServerLoad } from '@/lib/retryServerLoad';
import { learnAndRecordHost, resolveHostUrl } from '@/lib/hostRoutes';

function ServerErrorComponent({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();
  const { serverId } = useParams({ from: '/server/$serverId' });
  const { servers, editServer } = useServerContext();
  const server = servers.find((candidate) => candidate.id === serverId);

  if (error instanceof AuthError && server) {
    return (
      <PairDeviceScreen
        server={server}
        onPaired={(token) => {
          editServer(server.id, { token });
          void router.invalidate();
        }}
      />
    );
  }

  const handleGoToServerSelection = () => {
    router.navigate({ to: '/', search: { select: true }, replace: true });
  };

  return (
    <div className="flex w-full items-center justify-center min-h-screen bg-background text-foreground">
      <div className="text-center space-y-4 p-8 max-w-lg w-full">
        <h2 className="text-lg font-semibold">Server Connection Error</h2>
        <p className="text-muted-foreground text-sm">
          {error instanceof Error ? error.message : 'An unknown error occurred'}
        </p>
        <div className="space-y-2 pt-2">
          <button
            onClick={() => reset()}
            className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >Retry</button>
          <button
            onClick={handleGoToServerSelection}
            className="w-full px-4 py-2 rounded-md border border-border bg-background text-foreground text-sm font-medium hover:bg-accent"
          >Back to Server Selection</button>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/server/$serverId')({
  beforeLoad: ({ params, context }) => {
    const server = context.serverRegistry.getServer(params.serverId);
    if (!server) {
      throw redirect({
        to: '/',
        search: { select: true },
        replace: true,
        throw: true,
      });
    }
    return { server };
  },
  // Bootstrap data only. Stores and mutations own it afterwards, so navigation within the
  // server must not refetch it. router.invalidate() (configuration close) still reloads.
  staleTime: Infinity,
  shouldReload: false,
  loader: async ({ params, context, abortController }): Promise<CriticalServerData> => {
    const server = context.serverRegistry.getServer(params.serverId);
    if (!server) {
      throw redirect({
        to: '/',
        search: { select: true },
        replace: true,
        throw: true,
      });
    }
    mark('server-loader:start');
    try {
      // The same machine may answer at several addresses (LAN, Tailscale, proxy).
      const url = await resolveHostUrl(server, abortController.signal);
      const data = await retryServerLoad(
        signal => fetchCriticalServerData(url, server.token, signal),
        abortController.signal,
      );
      setLastSelectedServerId(params.serverId);
      void learnAndRecordHost(server, url);
      mark('server-loader:all-ready');
      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      // Unpaired or revoked: the error component offers pairing instead of a retry loop.
      if (err instanceof AuthError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to connect to server: ${message}`, { cause: err });
    }
  },
  component: () => (
    <StoreHydrator>
      <ServerShell />
    </StoreHydrator>
  ),
  errorComponent: ServerErrorComponent,
  pendingComponent: () => (
    <div className="w-full flex items-center justify-center min-h-screen bg-background text-foreground">
      <div className="text-center space-y-2">
        <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mx-auto" />
        <p role="status" className="text-sm text-muted-foreground">Connecting to server...</p>
        <p className="text-xs text-muted-foreground">If the server is offline, this page will retry automatically.</p>
        <Link to="/" search={{ select: true }} replace className="block text-sm underline underline-offset-4">
          Back to Server Selection
        </Link>
      </div>
    </div>
  ),
});
