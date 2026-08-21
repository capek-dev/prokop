import type { McpStatus } from '@prokopai/sdk';
import type { McpLifecyclePort, McpWorkspacePort } from '../ports/mcp';

/**
 * MCP HTTP use cases (S5). Owns the route-level MCP lifecycle orchestration
 * (status, connect, disconnect, restart) over the lifecycle and workspace
 * ports. Transport maps the discriminated results to HTTP statuses exactly
 * as before; the MCP process implementation stays behind the port.
 */

export interface McpApplicationDeps {
  lifecycle: McpLifecyclePort;
  workspaces: McpWorkspacePort;
}

export type McpStatusResult =
  | { kind: 'ok'; status: Record<string, { config: unknown; status: McpStatus }> }
  | { kind: 'workspace_not_found' };

export type McpConnectResult =
  | { kind: 'ok'; status: McpStatus }
  | { kind: 'workspace_not_found' }
  | { kind: 'server_not_found' };

export type McpDisconnectResult =
  | { kind: 'ok' }
  | { kind: 'workspace_not_found' };

export interface McpHttpApplication {
  status(workspaceId: string): Promise<McpStatusResult>;
  connect(workspaceId: string, name: string): Promise<McpConnectResult>;
  disconnect(workspaceId: string, name: string): Promise<McpDisconnectResult>;
  restart(workspaceId: string): Promise<McpStatusResult>;
}

export function createMcpHttpApplication(deps: McpApplicationDeps): McpHttpApplication {
  async function workspacePathOr(workspaceId: string): Promise<string | null> {
    return deps.workspaces.getWorkspacePath(workspaceId);
  }

  return {
    async status(workspaceId) {
      const workspacePath = await workspacePathOr(workspaceId);
      if (workspacePath === null) {
        return { kind: 'workspace_not_found' };
      }
      const status = await deps.lifecycle.getAllServerStatus(workspacePath);
      return { kind: 'ok', status };
    },

    async connect(workspaceId, name) {
      const workspacePath = await workspacePathOr(workspaceId);
      if (workspacePath === null) {
        return { kind: 'workspace_not_found' };
      }
      const config = await deps.lifecycle.getMcpServers(workspacePath);
      const serverConfig = config[name];
      if (!serverConfig) {
        return { kind: 'server_not_found' };
      }
      const status = await deps.lifecycle.connectServer(workspacePath, name, serverConfig);
      return { kind: 'ok', status };
    },

    async disconnect(workspaceId, name) {
      const workspacePath = await workspacePathOr(workspaceId);
      if (workspacePath === null) {
        return { kind: 'workspace_not_found' };
      }
      await deps.lifecycle.disconnectServer(workspacePath, name);
      return { kind: 'ok' };
    },

    async restart(workspaceId) {
      const workspacePath = await workspacePathOr(workspaceId);
      if (workspacePath === null) {
        return { kind: 'workspace_not_found' };
      }
      await deps.lifecycle.shutdownWorkspace(workspacePath);
      await deps.lifecycle.initializeWorkspace(workspacePath);
      const status = await deps.lifecycle.getAllServerStatus(workspacePath);
      return { kind: 'ok', status };
    },
  };
}
