import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLoaderData, useParams } from '@tanstack/react-router';
import { clearSessionState } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useOverviewGroupsStore } from '@/stores/overviewGroupsStore';
import type { CriticalServerData } from '@/lib/fetchServerData';
import { fetchSecondaryServerData } from '@/lib/fetchServerData';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { mark } from '@/lib/perf';
import { useServerContext } from '@/contexts/ServerContext';

interface StoreHydratorProps {
  children: ReactNode;
}

export function StoreHydrator({ children }: StoreHydratorProps) {
  const data = useLoaderData({
    from: '/server/$serverId',
    strict: false,
    structuralSharing: true,
  } as unknown as Parameters<typeof useLoaderData>[0]) as CriticalServerData | undefined;
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params.serverId as string | undefined;

  const { servers, quickConnections, isHydrated: isServerContextHydrated } = useServerContext();
  const activeServer = servers.find(s => s.id === serverId) ?? null;
  const serverUrl = activeServer?.url ?? null;
  const apiToken = activeServer?.token ?? undefined;

  const secondaryLoadedRef = useRef<string | null>(null);

  // Wait for quick connections to load before running first-time migration.
  useEffect(() => {
    if (!isServerContextHydrated) return;
    void useOverviewGroupsStore.getState().hydrate(quickConnections);
  }, [isServerContextHydrated, quickConnections]);

  useLayoutEffect(() => {
    if (!data) return;
    mark('shell:first-render');

    const usableModels = (data.models || []).filter((m) => m.runtimeStatus?.usable);
    useServerDataStore.getState().hydrateCritical(serverId ?? '', {
      workspaces: data.workspaces,
      preconfigs: data.preconfigs,
      models: usableModels,
      defaultModel: data.defaultModel || 'gpt-4o',
      defaultProvider: data.defaultProvider || 'openai',
    });

    queryClient.setQueryData(queryKeys.config.preconfigs, { preconfigs: data.preconfigs });

    const pendingWorkspaceId = localStorage.getItem('activeWorkspaceId');
    const workspaces = data.workspaces;
    const defaultWorkspace = workspaces.find(workspace => !workspace.settings?.isAgentHome)
      ?? workspaces[0];
    if (pendingWorkspaceId) {
      const saved = workspaces.find(w => w.id === pendingWorkspaceId);
      if (saved) {
        useServerDataStore.getState().setActiveWorkspace(saved);
      } else if (defaultWorkspace) {
        useServerDataStore.getState().setActiveWorkspace(defaultWorkspace);
      }
    } else if (defaultWorkspace) {
      useServerDataStore.getState().setActiveWorkspace(defaultWorkspace);
    }
  }, [data, serverId]);

  useEffect(() => {
    if (!data || !serverUrl || !serverId) return;
    if (secondaryLoadedRef.current === serverId) return;
    secondaryLoadedRef.current = serverId;

    const controller = new AbortController();

    fetchSecondaryServerData(serverUrl, apiToken, controller.signal)
      .then((secondary) => {
        useServerDataStore.getState().hydrateSecondary({
          prompts: secondary.prompts,
          providers: secondary.providers,
          agents: secondary.agents,
        });

        if (secondary.prompts.length > 0 || secondary.errors.prompts === null) {
          queryClient.setQueryData(queryKeys.config.prompts, { prompts: secondary.prompts });
        }
        if (secondary.providers.length > 0 || secondary.errors.providers === null) {
          queryClient.setQueryData(queryKeys.config.providers.all, { providers: secondary.providers });
        }
        if (secondary.agents.length > 0 || secondary.errors.agents === null) {
          queryClient.setQueryData(queryKeys.config.agents, { agents: secondary.agents });
        }

        if (secondary.errors.prompts) {
          console.warn('[bootstrap] Failed to load prompts:', secondary.errors.prompts);
        }
        if (secondary.errors.providers) {
          console.warn('[bootstrap] Failed to load providers:', secondary.errors.providers);
        }
        if (secondary.errors.agents) {
          console.warn('[bootstrap] Failed to load agents:', secondary.errors.agents);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[bootstrap] Secondary data fetch failed:', err);
      });

    return () => {
      controller.abort();
      secondaryLoadedRef.current = null;
    };
  }, [data, serverUrl, serverId, apiToken]);

  useEffect(() => {
    return () => {
      clearSessionState();
      useServerDataStore.getState().clearAll();
      queryClient.removeQueries({ queryKey: ['sessions'] });
      queryClient.removeQueries({ queryKey: ['config'] });
      queryClient.removeQueries({ queryKey: ['transcript'] });
      queryClient.removeQueries({ queryKey: ['pinnedMessages'] });
      queryClient.removeQueries({ queryKey: ['mcp'] });
      queryClient.removeQueries({ queryKey: ['scheduledJobs'] });
    };
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading server data...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
