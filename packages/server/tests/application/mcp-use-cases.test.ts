import { describe, expect, test } from 'bun:test';
import type { McpServerConfig, McpStatus } from '@jean2/sdk';
import {
  createMcpHttpApplication,
  type McpHttpApplication,
} from '@/application/mcp';
import type { McpLifecyclePort, McpWorkspacePort } from '@/application/ports/mcp';

interface FakeState {
  workspaces: Map<string, string>;
  servers: Record<string, McpServerConfig>;
  log: string[];
}

function makeState(): FakeState {
  return {
    workspaces: new Map([['ws-1', '/ws/path']]),
    servers: { alpha: { type: 'local', command: ['node'], enabled: true } },
    log: [],
  };
}

function makeApplication(state: FakeState): McpHttpApplication {
  const connected: McpStatus = { status: 'connected' };

  const lifecycle: McpLifecyclePort = {
    initializeWorkspace: async (workspacePath) => {
      state.log.push(`initialize:${workspacePath}`);
    },
    shutdownWorkspace: async (workspacePath) => {
      state.log.push(`shutdown:${workspacePath}`);
    },
    connectServer: async (workspacePath, name, _config) => {
      state.log.push(`connect:${workspacePath}:${name}`);
      return connected;
    },
    disconnectServer: async (workspacePath, name) => {
      state.log.push(`disconnect:${workspacePath}:${name}`);
    },
    getServerStatus: async () => connected,
    getAllServerStatus: async (workspacePath) => {
      state.log.push(`status:${workspacePath}`);
      return {
        alpha: { config: state.servers.alpha, status: connected },
      };
    },
    getTools: async () => ({}),
    startAuth: async () => ({ authorizationUrl: 'https://auth' }),
    finishAuth: async () => connected,
    getMcpServers: async (workspacePath) => {
      state.log.push(`servers:${workspacePath}`);
      return state.servers;
    },
  };

  const workspaces: McpWorkspacePort = {
    getWorkspacePath: (workspaceId) => state.workspaces.get(workspaceId) ?? null,
  };

  return createMcpHttpApplication({ lifecycle, workspaces });
}

describe('mcp application use cases', () => {
  test('status returns the server map or workspace_not_found', async () => {
    const state = makeState();
    const application = makeApplication(state);

    const ok = await application.status('ws-1');
    expect(ok).toEqual({
      kind: 'ok',
      status: { alpha: { config: state.servers.alpha, status: { status: 'connected' } } },
    });
    expect(state.log).toContain('status:/ws/path');

    expect(await application.status('missing')).toEqual({ kind: 'workspace_not_found' });
  });

  test('connect resolves the config and distinguishes missing servers', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(await application.connect('ws-1', 'alpha')).toEqual({ kind: 'ok', status: { status: 'connected' } });
    expect(state.log).toContain('servers:/ws/path');
    expect(state.log).toContain('connect:/ws/path:alpha');

    expect(await application.connect('ws-1', 'ghost')).toEqual({ kind: 'server_not_found' });
    expect(await application.connect('missing', 'alpha')).toEqual({ kind: 'workspace_not_found' });
  });

  test('disconnect delegates and returns ok', async () => {
    const state = makeState();
    const application = makeApplication(state);

    expect(await application.disconnect('ws-1', 'alpha')).toEqual({ kind: 'ok' });
    expect(state.log).toContain('disconnect:/ws/path:alpha');
    expect(await application.disconnect('missing', 'alpha')).toEqual({ kind: 'workspace_not_found' });
  });

  test('restart shuts down, reinitializes, and reports status in that exact order', async () => {
    const state = makeState();
    const application = makeApplication(state);

    const result = await application.restart('ws-1');
    expect(result.kind).toBe('ok');
    expect(state.log).toEqual([
      'shutdown:/ws/path',
      'initialize:/ws/path',
      'status:/ws/path',
    ]);

    expect(await application.restart('missing')).toEqual({ kind: 'workspace_not_found' });
  });
});
