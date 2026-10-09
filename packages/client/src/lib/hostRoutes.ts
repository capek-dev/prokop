import { create } from 'zustand';
import { getAccessStatus, type SavedServer } from '@prokopai/sdk';
import { normalizeServerUrl } from '@/config/auth';
import { buildApiUrl } from '@/config/urls';
import { recordServerIdentity } from '@/config/servers';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

/**
 * Host routes: one saved server can be reached at several URLs (LAN at home,
 * Tailscale away, a proxy). The client picks the first that answers as the
 * same installation, remembers it for this session, and learns new routes
 * from the server after connecting. A route that answers as a different
 * installation is never used.
 */

const PROBE_TIMEOUT_MS = 2_500;

interface HostRouteState {
  /** Resolved URL per saved server id for this page session. */
  urls: Record<string, string>;
  setUrl: (serverId: string, url: string) => void;
}

export const useHostRouteStore = create<HostRouteState>((set) => ({
  urls: {},
  setUrl: (serverId, url) => set((state) => (state.urls[serverId] === url ? state : { urls: { ...state.urls, [serverId]: url } })),
}));

/** The URL the client uses for this server right now. */
export function effectiveServerUrl(server: Pick<SavedServer, 'id' | 'url'>): string {
  return useHostRouteStore.getState().urls[server.id] ?? server.url;
}

export function useEffectiveServerUrl(server: Pick<SavedServer, 'id' | 'url'> | null | undefined): string | null {
  const resolved = useHostRouteStore((state) => (server ? state.urls[server.id] : undefined));
  return server ? resolved ?? server.url : null;
}

/** Candidate URLs in preference order: last good, saved primary, learned routes. */
export function routeCandidates(server: Pick<SavedServer, 'id' | 'url' | 'routes'>): string[] {
  const ordered = [useHostRouteStore.getState().urls[server.id], server.url, ...(server.routes ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => normalizeServerUrl(value));
  return Array.from(new Set(ordered));
}

/** Reads `/api/info`; null when the URL does not answer as a Prokop server in time. */
export async function probeInstallation(url: string, signal?: AbortSignal): Promise<{ installationId: string | null } | null> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetch(buildApiUrl(url, '/api/info'), { signal: combined });
    if (!response.ok) return null;
    const info = await response.json() as { installationId?: unknown };
    return { installationId: typeof info.installationId === 'string' ? info.installationId : null };
  } catch {
    return null;
  }
}

/** How long a less-preferred address that answered waits for better ones still probing. */
const PREFERENCE_GRACE_MS = 300;

/**
 * Picks the address to use for a server. An address that already worked in
 * this page session is reused without probing; pass `reprobe` after a failure
 * (the failover path). Otherwise all candidates are probed in parallel and the
 * most preferred one that answers as this installation wins. A less-preferred
 * answer waits at most PREFERENCE_GRACE_MS for better candidates, so an
 * unreachable LAN address away from home does not delay every switch. When
 * nothing answers, the saved URL is returned so normal offline handling runs.
 */
export async function resolveHostUrl(
  server: Pick<SavedServer, 'id' | 'url' | 'routes' | 'installationId'>,
  signal?: AbortSignal,
  options: { reprobe?: boolean } = {},
): Promise<string> {
  const known = useHostRouteStore.getState().urls[server.id];
  if (known && !options.reprobe) return known;
  const candidates = routeCandidates(server);
  if (candidates.length <= 1) return candidates[0] ?? server.url;

  const url = await new Promise<string>((resolve) => {
    const answered: Array<boolean | undefined> = candidates.map(() => undefined);
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (chosen: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      resolve(chosen);
    };
    const bestAnswered = () => candidates[answered.indexOf(true)];
    const evaluate = () => {
      for (let index = 0; index < candidates.length; index++) {
        if (answered[index] === true) return finish(candidates[index]!);
        if (answered[index] === undefined) {
          // A more preferred address is still probing; give it a short head start.
          if (grace === undefined && answered.includes(true)) {
            grace = setTimeout(() => finish(bestAnswered()!), PREFERENCE_GRACE_MS);
          }
          return;
        }
      }
      finish(server.url);
    };
    candidates.forEach((candidate, index) => {
      void probeInstallation(candidate, signal).then((result) => {
        answered[index] = result !== null && (!server.installationId || result.installationId === server.installationId);
        evaluate();
      });
    });
  });
  useHostRouteStore.getState().setUrl(server.id, url);
  return url;
}

export interface LearnedHost {
  installationId: string | null;
  routes: string[];
}

/** After connecting: the server's identity and the addresses it is published under. */
export async function learnHost(url: string, token: string | undefined, signal?: AbortSignal): Promise<LearnedHost | null> {
  const info = await probeInstallation(url, signal);
  if (!info) return null;
  let routes: string[] = [];
  try {
    routes = (await getAccessStatus(url, token, signal)).addresses ?? [];
  } catch {
    // Older servers have no auth status; identity alone is still useful.
  }
  return { installationId: info.installationId, routes: routes.map((route) => normalizeServerUrl(route)) };
}

/**
 * Fire-and-forget after a successful connection: records identity and routes,
 * merging duplicate entries for the same machine. Never runs against a route
 * that answered as a different installation.
 */
export async function learnAndRecordHost(server: SavedServer, url: string): Promise<void> {
  const learned = await learnHost(url, server.token);
  if (!learned) return;
  if (server.installationId && learned.installationId && learned.installationId !== server.installationId) return;
  const mergedIds = recordServerIdentity(server.id, learned);
  useOverviewGroupsStore.getState().reassignServerGroups(mergedIds, server.id);
}
