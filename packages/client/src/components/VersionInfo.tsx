import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CLIENT_VERSION } from '@/version';
import { checkUpdate, type UpdateStatus } from '@/utils/version';
import {
  fetchLatestServerVersion,
  fetchLatestClientVersion,
  clearVersionCache,
} from '@/utils/githubVersion';

interface VersionInfoProps {
  sdkClient: ProkopaiClient | null;
  enabled: boolean;
}

interface VersionState {
  serverVersion: string | null;
  latestServer: string | null;
  latestClient: string | null;
  loading: boolean;
  lastChecked: number | null;
  fetchError: string | null;
}

function formatLastChecked(timestamp: number | null): string {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function StatusBadge({ status }: { status: UpdateStatus }) {
  if (status === 'up-to-date') {
    return (
      <span className="text-xs text-green-500 flex items-center gap-1">
        <span className="inline-block size-1.5 rounded-full bg-green-500" />
        Up to date
      </span>
    );
  }
  if (status === 'update-available') {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
        Update available
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Unknown</span>;
}

export function VersionInfo({ sdkClient, enabled }: VersionInfoProps) {
  const fetchIdRef = useRef(0);

  const [state, setState] = useState<VersionState>({
    serverVersion: null,
    latestServer: null,
    latestClient: null,
    loading: true,
    lastChecked: null,
    fetchError: null,
  });

  const fetchVersions = useCallback(async (force = false) => {
    if (force) clearVersionCache();

    const currentFetchId = ++fetchIdRef.current;
    setState(prev => ({ ...prev, loading: true, fetchError: null }));

    try {
      const results = await Promise.allSettled([
        sdkClient
          ? sdkClient.httpClient.get<{ version: string }>('/info').then(data => data.version).catch(() => null)
          : Promise.resolve(null),
        fetchLatestServerVersion(),
        fetchLatestClientVersion(),
      ]);

      if (fetchIdRef.current !== currentFetchId) return;

      const serverVersion = results[0].status === 'fulfilled' ? results[0].value : null;
      const latestServer = results[1].status === 'fulfilled' ? results[1].value : null;
      const latestClient = results[2].status === 'fulfilled' ? results[2].value : null;

      setState({
        serverVersion,
        latestServer,
        latestClient,
        loading: false,
        lastChecked: Date.now(),
        fetchError: null,
      });
    } catch {
      if (fetchIdRef.current !== currentFetchId) return;
      setState(prev => ({ ...prev, loading: false, fetchError: 'Unable to check for updates' }));
    }
  }, [sdkClient]);

  useEffect(() => {
    if (!enabled) return;
    fetchVersions();
  }, [fetchVersions, enabled]);

  const clientStatus = checkUpdate(CLIENT_VERSION, state.latestClient);
  const serverStatus = sdkClient && state.serverVersion
    ? checkUpdate(state.serverVersion, state.latestServer)
    : 'unknown';

  const handleCheckForUpdates = () => {
    fetchVersions(true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className="text-sm font-medium">Versions</Label>
        <p className="text-sm text-muted-foreground">Check for updates to client and server</p>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Client</span>
          {state.loading ? (
            <Skeleton className="h-5 w-32" />
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
              <StatusBadge status={clientStatus} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Server</span>
          {state.loading ? (
            <Skeleton className="h-5 w-32" />
          ) : state.serverVersion ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">v{state.serverVersion}</span>
              <StatusBadge status={serverStatus} />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Not connected</span>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Latest</span>
          {state.loading ? (
            <Skeleton className="h-5 w-48" />
          ) : (
            <span className="text-sm text-muted-foreground">
              {state.latestServer ? `v${state.latestServer} (server)` : ''}
              {state.latestServer && state.latestClient && ' · '}
              {state.latestClient ? `v${state.latestClient} (client)` : ''}
              {!state.latestServer && !state.latestClient && 'Unknown'}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        {state.lastChecked && !state.loading && (
          <span className="text-xs text-muted-foreground">
            Last checked: {formatLastChecked(state.lastChecked)}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckForUpdates}
          disabled={state.loading}
          className="ml-auto"
        >
          <RefreshCw className={`size-3.5 ${state.loading ? 'animate-spin' : ''}`} />
          Check for Updates
        </Button>
      </div>
    </div>
  );
}
