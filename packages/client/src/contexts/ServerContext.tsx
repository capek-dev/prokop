import {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import {
  getSavedServers,
  saveServer,
  getOrCreateServer,
  updateServer as updateServerStorage,
  renameServer as renameServerStorage,
  deleteServer,
  getQuickConnections,
  addQuickConnection,
  removeQuickConnection,
  removeQuickConnectionForWorkspace,
  renameQuickConnectionsForServer,
  reorderQuickConnections,
} from '@/config/servers';
import type { SavedServer, QuickConnection } from '@prokopai/sdk';
import { normalizeServerUrl } from '@/config/auth';
import { discoverServerNoAuth } from '@/lib/validateServerAuth';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';

interface ServerContextValue {
  servers: SavedServer[];
  quickConnections: QuickConnection[];
  isHydrated: boolean;
  isDiscovering: boolean;

  // Server CRUD actions
  addServer: (name: string, url: string, token?: string) => SavedServer;
  editServer: (
    id: string,
    updates: { name?: string; url?: string; token?: string },
  ) => void;
  renameServer: (id: string, name: string) => string | null;
  removeServer: (id: string) => void;

  // Quick connection actions
  addToQuickConnections: (
    serverId: string,
    serverName: string,
    workspaceId?: string,
    workspaceName?: string,
  ) => void;
  removeFromQuickConnections: (id: string) => void;
  removeFromQuickConnectionsByWorkspace: (workspaceId: string) => void;
  reorderQuick: (ids: string[]) => void;
}

export const ServerContext = createContext<ServerContextValue | null>(null);

interface ServerProviderProps {
  children: ReactNode;
}

export const ServerProvider = ({ children }: ServerProviderProps) => {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [quickConnections, setQuickConnections] = useState<QuickConnection[]>(
    [],
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const discoveryAttempted = useRef(false);

  useEffect(() => {
    const loadedServers = getSavedServers();
    const loadedQuickConnections = getQuickConnections();

    setServers(loadedServers);
    setQuickConnections(loadedQuickConnections);
    setIsDiscovering(loadedServers.length === 0);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated || discoveryAttempted.current) return;
    if (servers.length > 0) {
      discoveryAttempted.current = true;
      return;
    }

    discoveryAttempted.current = true;

    void discoverServerNoAuth()
      .then((result) => {
        if (result.available) {
          getOrCreateServer(result.url, { name: 'Home' });
          setServers(getSavedServers());
        }
      })
      .finally(() => setIsDiscovering(false));
  }, [isHydrated, servers.length]);

  const addServer = useCallback((name: string, url: string, token?: string): SavedServer => {
    const normalizedUrl = normalizeServerUrl(url);

    const newServer: SavedServer = {
      id: crypto.randomUUID(),
      name,
      url: normalizedUrl,
      ...(token ? { token } : {}),
      createdAt: new Date().toISOString(),
    };

    saveServer(newServer);
    setServers(getSavedServers());

    return newServer;
  }, []);

  const editServer = useCallback((
    id: string,
    updates: { name?: string; url?: string; token?: string },
  ): void => {
    const normalizedUpdates = {
      ...updates,
      ...(updates.url && { url: normalizeServerUrl(updates.url) }),
    };

    updateServerStorage(id, normalizedUpdates);
    if (updates.name) {
      renameQuickConnectionsForServer(id, updates.name);
      setQuickConnections(getQuickConnections());
    }
    setServers(getSavedServers());
  }, []);

  const renameServer = useCallback((id: string, name: string): string | null => {
    const error = renameServerStorage(id, name);
    if (error) return error;

    setServers(getSavedServers());
    setQuickConnections(getQuickConnections());
    return null;
  }, []);

  const removeServer = useCallback((id: string): void => {
    deleteServer(id);
    setServers(getSavedServers());
    // Refresh quick connections as they may have been cleaned up
    setQuickConnections(getQuickConnections());
    // Remove overview groups for the deleted server
    useOverviewGroupsStore.getState().removeServerGroups(id);
  }, []);

  const addToQuickConnections = useCallback((
    serverId: string,
    serverName: string,
    workspaceId?: string,
    workspaceName?: string,
  ): void => {
    addQuickConnection({
      serverId,
      serverName,
      workspaceId,
      workspaceName,
    });
    setQuickConnections(getQuickConnections());
  }, []);

  const removeFromQuickConnections = useCallback((id: string): void => {
    removeQuickConnection(id);
    setQuickConnections(getQuickConnections());
  }, []);

  const removeFromQuickConnectionsByWorkspace = useCallback((workspaceId: string): void => {
    removeQuickConnectionForWorkspace(workspaceId);
    setQuickConnections(getQuickConnections());
  }, []);

  const reorderQuick = useCallback((ids: string[]): void => {
    reorderQuickConnections(ids);
    setQuickConnections(getQuickConnections());
  }, []);

  const value: ServerContextValue = {
    servers,
    quickConnections,
    isHydrated,
    isDiscovering,
    addServer,
    editServer,
    renameServer,
    removeServer,
    addToQuickConnections,
    removeFromQuickConnections,
    removeFromQuickConnectionsByWorkspace,
    reorderQuick,
  };

  return (
    <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
  );
};

export const useServerContext = (): ServerContextValue => {
  const context = useContext(ServerContext);

  if (context === null) {
    throw new Error(
      'useServerContext must be used within a ServerProvider',
    );
  }

  return context;
};
