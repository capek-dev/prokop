import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useServerClient } from '@/contexts/ServerClientContext';
import { fetchLatestServerVersion } from '@/utils/githubVersion';
import { checkUpdate, parseVersion } from '@/utils/version';

const notified = new Set<string>();

export function useServerUpdate(): string | null {
  const { sdkClient, serverUrl, connected } = useServerClient();
  const { data } = useQuery({
    queryKey: ['server-update', serverUrl],
    enabled: Boolean(sdkClient && serverUrl && connected),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    queryFn: async ({ signal }) => {
      const [info, latest] = await Promise.all([
        sdkClient!.httpClient.get<{ version?: unknown }>('/info', { signal }),
        fetchLatestServerVersion(),
      ]);
      const current = info.version;
      return typeof current === 'string' && parseVersion(current)
        && latest && checkUpdate(current, latest) === 'update-available'
        ? latest : null;
    },
  });
  const latestVersion = connected && sdkClient ? data ?? null : null;

  useEffect(() => {
    if (!latestVersion || !serverUrl) return;
    const key = `prokop-update:${serverUrl}:${latestVersion}`;
    if (notified.has(key)) return;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Storage may be unavailable in private browsers. In-memory deduplication still works.
    }
    notified.add(key);
    toast(`Prokop v${latestVersion} is available`, {
      id: key,
      description: 'Run prokop update in a terminal on the machine hosting this server.',
      duration: 8000,
    });
  }, [latestVersion, serverUrl]);

  return latestVersion;
}
