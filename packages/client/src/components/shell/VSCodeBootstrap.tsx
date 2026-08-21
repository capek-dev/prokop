import { useEffect, useState, type ReactNode } from 'react';
import { HttpClient, HttpNamespace } from '@prokopai/sdk';
import type { Workspace, SavedServer } from '@prokopai/sdk';
import { platform } from '@/platform';
import type { PlatformInitConfig } from '@/platform';
import { setSingleServer } from '@/config/servers';
import { useServerDataStore } from '@/stores/serverDataStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { router, RouterApp } from '@/router';

type Phase =
  | { id: 'init' }
  | { id: 'connecting'; message: string }
  | { id: 'ready' }
  | { id: 'error'; message: string };

export default function VSCodeBootstrap({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ id: 'init' });

  useEffect(() => {
    const unsubscribe = platform.onInit?.(async (config: PlatformInitConfig) => {
      setPhase({ id: 'connecting', message: 'Connecting to server...' });

      try {
        const serverId = `vscode-${new URL(config.serverUrl).host}`;
        const server: SavedServer = {
          id: serverId,
          name: 'VSCode',
          url: config.serverUrl,
          ...(config.token ? { token: config.token } : {}),
          createdAt: new Date().toISOString(),
        };
        setSingleServer(server);

        const httpClient = new HttpClient({
          url: config.serverUrl,
          ...(config.token ? { token: config.token } : {}),
        });
        const http = new HttpNamespace(httpClient);

        setPhase({ id: 'connecting', message: 'Loading workspace...' });

        const data = await http.loadAll();

        let workspace: Workspace | undefined;

        if (config.workspacePath) {
          workspace = data.workspaces.find((w) => w.path === config.workspacePath);
          if (!workspace) {
            setPhase({ id: 'connecting', message: 'Initializing workspace...' });
            const name = config.workspacePath.split(/[/\\]/).pop() || 'Workspace';
            const result = await http.workspaces.create({
              name,
              path: config.workspacePath,
              isVirtual: false,
            });
            workspace = result.workspace;
          }
        }

        const usableModels = (data.models || []).filter(
          (m) => m.runtimeStatus?.usable,
        );

        useServerDataStore.getState().hydrate(serverId, {
          workspaces: data.workspaces,
          preconfigs: data.preconfigs,
          prompts: data.prompts,
          models: usableModels,
          defaultModel: data.defaultModel || 'gpt-4o',
          defaultProvider: data.defaultProvider || 'openai',
          providers: data.providers,
          agents: data.agents || [],
        });

        if (workspace) {
          useServerDataStore.getState().setActiveWorkspace(workspace);
          localStorage.setItem('activeWorkspaceId', workspace.id);
        } else if (data.workspaces.length > 0) {
          useServerDataStore.getState().setActiveWorkspace(data.workspaces[0]);
          localStorage.setItem('activeWorkspaceId', data.workspaces[0].id);
        }

        await router.navigate({
          to: '/server/$serverId/workspace',
          params: { serverId },
        });
        setPhase({ id: 'ready' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        console.error('[VSCodeBootstrap] Connection failed:', err);
        console.error('[VSCodeBootstrap] Error message:', message);
        if (stack) console.error('[VSCodeBootstrap] Stack:', stack);
        setPhase({ id: 'error', message: `Failed to connect: ${message}` });
      }
    });

    return unsubscribe;
  }, []);

  if (phase.id === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center space-y-4 p-8 max-w-md">
          <h2 className="text-lg font-semibold">Connection Error</h2>
          <p className="text-sm text-muted-foreground">{phase.message}</p>
          <button
            onClick={() => setPhase({ id: 'init' })}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (phase.id === 'init' || phase.id === 'connecting') {
    // Show loading overlay while waiting for init or during async connect
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">
            {phase.id === 'connecting' ? phase.message : 'Waiting for editor...'}
          </p>
        </div>
      </div>
    );
  }

  // phase.id === 'ready' — children (RouterApp) take over
  return <>{children}</>;
}

export function VSCodeEntry() {
  return (
    <VSCodeBootstrap>
      <ErrorBoundary>
        <RouterApp />
      </ErrorBoundary>
    </VSCodeBootstrap>
  );
}
