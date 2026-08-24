import type { SavedServer } from '@prokopai/sdk';

export function selectStartupServer(
  servers: SavedServer[],
  lastSelectedServerId: string | null,
  explicitSelection: boolean,
): SavedServer | null {
  if (explicitSelection) return null;
  if (servers.length === 1) return servers[0];
  if (servers.length < 2 || lastSelectedServerId === null) return null;
  return servers.find((server) => server.id === lastSelectedServerId) ?? null;
}

export interface StartupResolution {
  destination: SavedServer | null;
  showStartup: boolean;
}

export function resolveStartup(
  servers: SavedServer[],
  lastSelectedServerId: string | null,
  explicitSelection: boolean,
  isHydrated: boolean,
  isDiscovering: boolean,
): StartupResolution {
  if (!isHydrated) {
    return { destination: null, showStartup: true };
  }
  if (isDiscovering) {
    return { destination: null, showStartup: servers.length === 0 };
  }

  const destination = selectStartupServer(
    servers,
    lastSelectedServerId,
    explicitSelection,
  );
  return { destination, showStartup: destination !== null };
}
