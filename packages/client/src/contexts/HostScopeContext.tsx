import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Agent, ModelWithStatus, Preconfig, PromptInfo, SavedServer, Session, Workspace } from '@prokopai/sdk';
import { fetchCriticalServerData, fetchSecondaryServerData } from '@/lib/fetchServerData';
import { resolveHostUrl } from '@/lib/hostRoutes';
import { useForeignSessionsStore } from '@/stores/foreignSessionsStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';

/**
 * Server data a session pane reads (models, prompts, agents, workspaces). A
 * pane for another machine's session is wrapped in a HostScope so these come
 * from that machine instead of the active one.
 */
export interface ScopedServerData {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  preconfigs: Preconfig[];
  prompts: PromptInfo[];
  models: ModelWithStatus[];
  defaultModel: string;
  agents: Agent[];
}

export interface HostScope {
  serverId: string;
  serverName: string;
  data: ScopedServerData;
}

const HostScopeContext = createContext<HostScope | null>(null);
export const HostScopeProvider = HostScopeContext.Provider;

/** The other machine a pane belongs to, or null inside the active machine's UI. */
export function useHostScope(): HostScope | null {
  return useContext(HostScopeContext);
}

/** Reads pane server data from the pane's machine. */
export function useScopedServerData<T>(selector: (data: ScopedServerData) => T): T {
  const scope = useContext(HostScopeContext);
  const local = useServerDataStore((state) => selector(state));
  return scope ? selector(scope.data) : local;
}

/** A session from the active machine's list or from the foreign sessions open on this board. */
export function useSessionById(sessionId: string | null | undefined): Session | undefined {
  const local = useSessionStore((state) => (sessionId ? state.sessions.find((session) => session.id === sessionId) : undefined));
  const foreign = useForeignSessionsStore((state) => (sessionId ? state.byId[sessionId]?.session : undefined));
  return local ?? foreign;
}

const EMPTY_DATA: ScopedServerData = {
  workspaces: [], activeWorkspace: null, preconfigs: [], prompts: [], models: [], defaultModel: '', agents: [],
};

/** Another machine's pane data, cached per machine. */
export function useHostServerData(server: SavedServer | undefined, activeWorkspaceId: string | null): ScopedServerData {
  const { data } = useQuery({
    queryKey: ['host-server-data', server?.id ?? null, server?.token ?? null],
    enabled: !!server,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const url = await resolveHostUrl(server!, signal);
      const [critical, secondary] = await Promise.all([
        fetchCriticalServerData(url, server!.token, signal),
        fetchSecondaryServerData(url, server!.token, signal),
      ]);
      return {
        workspaces: critical.workspaces,
        preconfigs: critical.preconfigs,
        models: (critical.models || []).filter((model) => model.runtimeStatus?.usable),
        defaultModel: critical.defaultModel || '',
        prompts: secondary.prompts,
        agents: secondary.agents,
      };
    },
  });
  if (!data) return EMPTY_DATA;
  return { ...data, activeWorkspace: data.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null };
}
