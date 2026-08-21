import { useState, useEffect, useCallback } from 'react';
import type { SavedServer } from '@prokopai/sdk';

export type ServerStatus = 'checking' | 'online' | 'offline';

export interface ServerStatusMap {
  [serverId: string]: ServerStatus;
}

async function checkServerStatus(server: SavedServer, signal?: AbortSignal): Promise<ServerStatus> {
  try {
    const proto = server.url.startsWith('https') ? 'https' : 'http';
    const clean = server.url.replace(/^https?:\/\//, '');
    const res = await fetch(`${proto}://${clean}/api/info`, { signal });
    return res.ok ? 'online' : 'offline';
  } catch {
    return 'offline';
  }
}

export function useServerStatus(servers: SavedServer[]) {
  const [statuses, setStatuses] = useState<ServerStatusMap>({});
  const [isChecking, setIsChecking] = useState(false);

  const checkAll = useCallback(() => {
    if (servers.length === 0) return;

    const controller = new AbortController();
    setIsChecking(true);

    const initial: ServerStatusMap = {};
    for (const s of servers) {
      initial[s.id] = 'checking';
    }
    setStatuses(initial);

    let pending = servers.length;

    for (const server of servers) {
      checkServerStatus(server, controller.signal).then((status) => {
        setStatuses((prev) => ({
          ...prev,
          [server.id]: status,
        }));
        pending--;
        if (pending === 0) {
          setIsChecking(false);
        }
      });
    }

    return () => controller.abort();
  }, [servers]);

  useEffect(() => {
    const cleanup = checkAll();
    return cleanup;
  }, [checkAll]);

  return { statuses, isChecking, refresh: checkAll };
}
