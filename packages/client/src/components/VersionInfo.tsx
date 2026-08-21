import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { CLIENT_VERSION } from '@/version';
import { checkUpdate, type UpdateStatus } from '@/utils/version';
import {
  fetchLatestServerVersion,
  fetchLatestClientVersion,
  clearVersionCache,
} from '@/utils/githubVersion';
import { platform } from '@/platform';

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

type ElectronUpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; percent: number; transferred: number; total: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

const isNative = platform.id === 'electron';

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

function ElectronClientStatus({ state }: { state: ElectronUpdateState }) {
  switch (state.status) {
    case 'idle':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <span className="text-xs text-muted-foreground">Unknown</span>
        </div>
      );
    case 'checking':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      );
    case 'available':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
            Update available
          </span>
        </div>
      );
    case 'not-available':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <span className="text-xs text-green-500 flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-green-500" />
            Up to date
          </span>
        </div>
      );
    case 'downloading':
      return (
        <div className="flex flex-col gap-1 items-end min-w-40">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
            <span className="text-xs text-muted-foreground">
              Downloading... {Math.round(state.percent)}%
            </span>
          </div>
          <Progress value={state.percent} className="w-full h-1" />
        </div>
      );
    case 'downloaded':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <span className="text-xs text-green-500 flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-green-500" />
            Update ready — restart to install
          </span>
        </div>
      );
    case 'error':
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">v{CLIENT_VERSION}</span>
          <span className="text-xs text-red-500">{state.message}</span>
        </div>
      );
  }
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

  const [electronUpdaterState, setElectronUpdaterState] = useState<ElectronUpdateState>({ status: 'idle' });

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
        isNative ? Promise.resolve(null) : fetchLatestClientVersion(),
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

  useEffect(() => {
    if (!platform.capabilities.updater) return;

    const unsubscribe = platform.onUpdaterEvent?.(event => {
      const { type, data } = event;
      switch (type) {
        case 'checking':
          setElectronUpdaterState({ status: 'checking' });
          break;
        case 'available':
          setElectronUpdaterState({ status: 'available', version: (data as { version: string }).version });
          break;
        case 'not-available':
          setElectronUpdaterState({ status: 'not-available', version: (data as { version: string }).version });
          break;
        case 'download-progress': {
          const d = data as { percent: number; transferred: number; total: number };
          setElectronUpdaterState({ status: 'downloading', percent: d.percent, transferred: d.transferred, total: d.total });
          break;
        }
        case 'downloaded':
          setElectronUpdaterState({ status: 'downloaded', version: (data as { version: string }).version });
          break;
        case 'error':
          setElectronUpdaterState({ status: 'error', message: (data as { message: string }).message });
          break;
      }
    });

    return unsubscribe;
  }, []);

  const clientStatus = checkUpdate(CLIENT_VERSION, state.latestClient);
  const serverStatus = sdkClient && state.serverVersion
    ? checkUpdate(state.serverVersion, state.latestServer)
    : 'unknown';

  const handleCheckForUpdates = () => {
    if (platform.capabilities.updater) {
      setElectronUpdaterState({ status: 'checking' });
      platform.checkForUpdates?.();
    } else {
      fetchVersions(true);
    }
  };

  const isCheckingOrDownloading = electronUpdaterState.status === 'checking' || electronUpdaterState.status === 'downloading';

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
          {isNative ? (
            <ElectronClientStatus state={electronUpdaterState} />
          ) : state.loading ? (
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

        {!isNative && (
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
        )}
      </div>

      <div className="flex items-center justify-between">
        {state.lastChecked && !state.loading && !isCheckingOrDownloading && (
          <span className="text-xs text-muted-foreground">
            Last checked: {formatLastChecked(state.lastChecked)}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheckForUpdates}
          disabled={state.loading || isCheckingOrDownloading}
          className="ml-auto"
        >
          <RefreshCw className={`size-3.5 ${state.loading || isCheckingOrDownloading ? 'animate-spin' : ''}`} />
          Check for Updates
        </Button>
      </div>
    </div>
  );
}
