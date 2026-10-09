import { normalizeServerUrl } from '@/config/auth';

export interface ServerReachableResult {
  success: boolean;
  error?: string;
}

export interface ServerDiscoverResult {
  available: boolean;
  url: string;
  authRequired?: boolean;
}

const LOCALHOST_CHECK_URL = 'localhost:8742';
const SERVER_CHECK_TIMEOUT_MS = 2000;

export function getDefaultServerUrl(
  currentLocation?: Pick<Location, 'origin' | 'protocol'>,
): string {
  const location = currentLocation
    ?? (typeof window === 'undefined' ? undefined : window.location);
  if (location?.protocol === 'http:' || location?.protocol === 'https:') {
    return location.origin;
  }
  return LOCALHOST_CHECK_URL;
}

async function probeServerNoAuth(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<ServerDiscoverResult> {
  const url = normalizeServerUrl(rawUrl);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, SERVER_CHECK_TIMEOUT_MS);

  try {
    const proto = url.startsWith('https://') ? 'https' : 'http';
    const clean = url.replace(/^https?:\/\//, '');
    const res = await fetch(`${proto}://${clean}/api/info`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      return { available: false, url };
    }

    interface ServerInfo {
      features?: { authentication?: boolean };
    }
    const info = (await res.json()) as ServerInfo;
    const authRequired = info.features?.authentication ?? false;
    return {
      available: !authRequired,
      url,
      ...(authRequired ? { authRequired: true } : {}),
    };
  } catch {
    return { available: false, url };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export interface DiscoverServerOptions {
  signal?: AbortSignal;
  currentLocation?: Pick<Location, 'origin' | 'protocol'>;
}

export async function discoverServerNoAuth(
  options: DiscoverServerOptions = {},
): Promise<ServerDiscoverResult> {
  const candidates = [
    getDefaultServerUrl(options.currentLocation),
    LOCALHOST_CHECK_URL,
  ];
  const uniqueCandidates = Array.from(
    new Set(candidates.map((candidate) => normalizeServerUrl(candidate))),
  );

  for (const candidate of uniqueCandidates) {
    if (options.signal?.aborted) break;
    const result = await probeServerNoAuth(candidate, options.signal);
    if (result.available || result.authRequired) return result;
  }

  return { available: false, url: normalizeServerUrl(candidates[0]) };
}

export function checkLocalhostNoAuth(
  signal?: AbortSignal,
): Promise<ServerDiscoverResult> {
  return probeServerNoAuth(LOCALHOST_CHECK_URL, signal);
}

/**
 * Checks that a server answers before saving it. Machines that require
 * pairing are fine: opening them shows the pairing screen.
 */
export async function checkServerReachable(rawUrl: string): Promise<ServerReachableResult> {
  const url = normalizeServerUrl(rawUrl);
  try {
    const proto = url.startsWith('https') ? 'https' : 'http';
    const clean = url.replace(/^https?:\/\//, '');
    const res = await fetch(`${proto}://${clean}/api/info`);
    if (!res.ok) {
      return { success: false, error: `Server returned ${res.status}. Check the URL and try again.` };
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Could not reach server: ${message}` };
  }
}
