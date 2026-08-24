// packages/client/src/config/servers.ts

import type { SavedServer, QuickConnection } from '@prokopai/sdk';
import { normalizeServerUrl } from './auth';

const STORAGE_KEYS = {
  SERVERS: 'prokopai_servers',
  QUICK_CONNECTIONS: 'prokopai_quick_connections',
  LAST_SERVER_ID: 'prokopai_last_server_id',
} as const;

/**
 * Get all saved servers from localStorage
 */
export function getSavedServers(): SavedServer[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SERVERS);
    if (!data) {
      return [];
    }
    return JSON.parse(data) as SavedServer[];
  } catch (error) {
    console.error('Error reading saved servers from localStorage:', error);
    return [];
  }
}

/**
 * Get a specific server by ID
 */
export function getServerById(id: string): SavedServer | null {
  const servers = getSavedServers();
  return servers.find((server) => server.id === id) || null;
}

export function getLastSelectedServerId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.LAST_SERVER_ID);
  } catch (error) {
    console.error('Error reading last selected server from localStorage:', error);
    return null;
  }
}

export function setLastSelectedServerId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_SERVER_ID, id);
  } catch (error) {
    console.error('Error saving last selected server to localStorage:', error);
  }
}

/**
 * Find a server by URL using normalized comparison.
 * Returns the existing server if found, null otherwise.
 */
export function findServerByUrl(url: string): SavedServer | null {
  const servers = getSavedServers();
  const normalized = normalizeServerUrl(url);
  return servers.find((s) => normalizeServerUrl(s.url) === normalized) || null;
}

/**
 * Save a new server to localStorage.
 * Does NOT deduplicate. Callers should use getOrCreateServer for
 * deduplication, or check findServerByUrl first.
 */
export function saveServer(server: SavedServer): void {
  try {
    const servers = getSavedServers();
    servers.push(server);
    localStorage.setItem(STORAGE_KEYS.SERVERS, JSON.stringify(servers));
  } catch (error) {
    console.error('Error saving server to localStorage:', error);
  }
}

/**
 * Get or create a saved server by URL.
 * If a server with a matching normalized URL exists, returns it.
 * Otherwise creates and saves a new one.
 */
export function getOrCreateServer(
  url: string,
  options: { name?: string; token?: string } = {},
): SavedServer {
  const existing = findServerByUrl(url);
  if (existing) {
    if (options.token && existing.token !== options.token) {
      updateServer(existing.id, { token: options.token });
    }
    return existing;
  }

  const normalizedUrl = normalizeServerUrl(url);
  const server: SavedServer = {
    id: crypto.randomUUID(),
    name: options.name || normalizedUrl,
    url: normalizedUrl,
    ...(options.token ? { token: options.token } : {}),
    createdAt: new Date().toISOString(),
  };
  saveServer(server);
  return server;
}

/**
 * Replace ALL saved servers with exactly one server.
 * Used by VSCode mode to enforce a single-server model where
 * the server is always the one from VSCode settings.
 */
export function setSingleServer(server: SavedServer): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SERVERS, JSON.stringify([server]));
  } catch (error) {
    console.error('Error setting single server in localStorage:', error);
  }
}

/**
 * Update an existing server
 * Merges updates with existing server data
 */
export function updateServer(
  id: string,
  updates: Partial<Omit<SavedServer, 'id' | 'createdAt'>>,
): void {
  try {
    const servers = getSavedServers();
    const index = servers.findIndex((server) => server.id === id);

    if (index === -1) {
      console.error('Server not found:', id);
      return;
    }

    servers[index] = { ...servers[index], ...updates };
    localStorage.setItem(STORAGE_KEYS.SERVERS, JSON.stringify(servers));
  } catch (error) {
    console.error('Error updating server in localStorage:', error);
  }
}

export function renameServer(id: string, name: string): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) return 'Server name is required.';

  const servers = getSavedServers();
  if (!servers.some((server) => server.id === id)) {
    return 'Server not found.';
  }
  if (servers.some(
    (server) => server.id !== id
      && server.name.toLowerCase() === trimmedName.toLowerCase(),
  )) {
    return `A server named "${trimmedName}" already exists.`;
  }

  updateServer(id, { name: trimmedName });
  renameQuickConnectionsForServer(id, trimmedName);
  return null;
}

/**
 * Delete a server by ID
 * Also removes related quick connections
 */
export function deleteServer(id: string): void {
  try {
    const servers = getSavedServers();
    const filtered = servers.filter((server) => server.id !== id);
    localStorage.setItem(STORAGE_KEYS.SERVERS, JSON.stringify(filtered));
    if (getLastSelectedServerId() === id) {
      localStorage.removeItem(STORAGE_KEYS.LAST_SERVER_ID);
    }

    // Also remove related quick connections
    const quickConnections = getQuickConnections();
    const filteredConnections = quickConnections.filter(
      (conn) => conn.serverId !== id,
    );
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(filteredConnections),
    );
  } catch (error) {
    console.error('Error deleting server from localStorage:', error);
  }
}

/**
 * Get all quick connections from localStorage
 */
export function getQuickConnections(): QuickConnection[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.QUICK_CONNECTIONS);
    if (!data) {
      return [];
    }
    return JSON.parse(data) as QuickConnection[];
  } catch (error) {
    console.error(
      'Error reading quick connections from localStorage:',
      error,
    );
    return [];
  }
}

/**
 * Add a new quick connection
 * Auto-generates ID and sets order to next available
 */
export function addQuickConnection(
  conn: Omit<QuickConnection, 'id' | 'order'>,
): QuickConnection {
  const connections = getQuickConnections();

  // Find max order
  const maxOrder = connections.reduce(
    (max, c) => Math.max(max, c.order),
    -1,
  );

  const newConnection: QuickConnection = {
    ...conn,
    id: crypto.randomUUID(),
    order: maxOrder + 1,
  };

  connections.push(newConnection);

  try {
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(connections),
    );
  } catch (error) {
    console.error(
      'Error saving quick connection to localStorage:',
      error,
    );
  }

  return newConnection;
}

/**
 * Remove a quick connection by ID
 */
export function removeQuickConnection(id: string): void {
  try {
    const connections = getQuickConnections();
    const filtered = connections.filter((conn) => conn.id !== id);
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(filtered),
    );
  } catch (error) {
    console.error(
      'Error removing quick connection from localStorage:',
      error,
    );
  }
}

/**
 * Remove all quick connections for a specific workspace
 * Used when deleting a workspace
 */
export function removeQuickConnectionForWorkspace(workspaceId: string): void {
  try {
    const connections = getQuickConnections();
    const filtered = connections.filter((conn) => conn.workspaceId !== workspaceId);
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(filtered),
    );
  } catch (error) {
    console.error(
      'Error removing quick connections for workspace from localStorage:',
      error,
    );
  }
}

/**
 * Update an existing quick connection
 */
export function updateQuickConnection(
  id: string,
  updates: Partial<QuickConnection>,
): void {
  try {
    const connections = getQuickConnections();
    const index = connections.findIndex((conn) => conn.id === id);

    if (index === -1) {
      console.error('Quick connection not found:', id);
      return;
    }

    connections[index] = { ...connections[index], ...updates };
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(connections),
    );
  } catch (error) {
    console.error(
      'Error updating quick connection in localStorage:',
      error,
    );
  }
}

export function renameQuickConnectionsForServer(
  serverId: string,
  serverName: string,
): void {
  try {
    const connections = getQuickConnections().map((connection) =>
      connection.serverId === serverId
        ? { ...connection, serverName }
        : connection,
    );
    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(connections),
    );
  } catch (error) {
    console.error('Error renaming server quick connections:', error);
  }
}

/**
 * Reorder quick connections based on array position
 * Updates order field based on the index in the provided array
 */
export function reorderQuickConnections(ids: string[]): void {
  try {
    const connections = getQuickConnections();

    // Create a map for quick lookup
    const connectionMap = new Map(connections.map((c) => [c.id, c]));

    // Update order based on array position
    ids.forEach((id, index) => {
      const conn = connectionMap.get(id);
      if (conn) {
        conn.order = index;
      }
    });

    localStorage.setItem(
      STORAGE_KEYS.QUICK_CONNECTIONS,
      JSON.stringify(connections),
    );
  } catch (error) {
    console.error(
      'Error reordering quick connections in localStorage:',
      error,
    );
  }
}
