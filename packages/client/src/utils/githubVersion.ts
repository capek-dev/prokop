const GITHUB_REPO = 'capek-dev/prokop';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT = 10_000; // 10 seconds

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCache<T>(key: string, value: T): void {
  cache.set(key, { value, timestamp: Date.now() });
}

export function clearVersionCache(): void {
  cache.clear();
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

interface GithubRelease {
  tag_name: string;
  prerelease: boolean;
}

export async function fetchLatestServerVersion(): Promise<string | null> {
  const cached = getCached<string>('latest-server');
  if (cached) return cached;

  try {
    // Follow same pattern as install script: fetch VERSION file from main branch
    const url = `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/packages/server/VERSION`;
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);
    if (!response.ok) return null;

    const version = (await response.text()).trim();
    // Validate it looks like a semver version
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;

    setCache('latest-server', version);
    return version;
  } catch {
    return null;
  }
}

export async function fetchLatestClientVersion(): Promise<string | null> {
  const cached = getCached<string>('latest-client');
  if (cached) return cached;

  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`;
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);
    if (!response.ok) return null;

    const releases: GithubRelease[] = await response.json();

    // Find the latest client release (tag starts with "client/", not a prerelease)
    const clientRelease = releases.find(
      (r) => r.tag_name.startsWith('client/') && !r.prerelease
    );
    if (!clientRelease) return null;

    // Extract version from tag: "client/v0.6.6" -> "0.6.6"
    const version = clientRelease.tag_name.replace(/^client\/v?/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;

    setCache('latest-client', version);
    return version;
  } catch {
    return null;
  }
}
