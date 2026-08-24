import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { fetchCriticalServerData, type CriticalServerData } from '@/lib/fetchServerData';
import { StoreHydrator } from '@/components/providers/StoreHydrator';
import ServerShell from '@/components/shell/ServerShell';
import { setLastSelectedServerId } from '@/config/servers';
import { mark } from '@/lib/perf';

function ServerErrorComponent({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  const router = useRouter();

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
      const data = await fetchCriticalServerData(server.url, server.token, abortController.signal);
      setLastSelectedServerId(params.serverId);
      mark('server-loader:all-ready');
      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
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
        <p className="text-sm text-muted-foreground">Connecting to server...</p>
      </div>
    </div>
  ),
});
