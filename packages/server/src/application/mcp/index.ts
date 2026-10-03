import type { McpStatus, McpServerConfig, McpToolInfo } from '@prokopai/sdk';
import type { McpLifecyclePort, McpWorkspacePort } from '@/application/ports/mcp';
import { NotFoundError } from '@/application/http-errors';
export { mcpNameSchema, mcpServerConfigSchema } from '@/domains/mcp/config';

/**
 * Workspace MCP settings and lifecycle use cases. Connection management,
 * tool policy and OAuth stay behind the host lifecycle port.
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
  save(workspaceId: string, name: string, config: McpServerConfig): Promise<void>;
  remove(workspaceId: string, name: string): Promise<void>;
  tools(workspaceId: string, name: string): Promise<McpToolInfo[]>;
  setToolEnabled(workspaceId: string, name: string, toolName: string, enabled: boolean): Promise<void>;
  startAuth(workspaceId: string, name: string, redirectUrl: string): Promise<{ authorizationUrl: string }>;
  finishAuth(state: string, code: string): Promise<{ status: McpStatus }>;
  finishWorkspaceAuth(workspaceId: string, name: string, state: string, code: string): Promise<{ status: McpStatus }>;
}

export function createMcpHttpApplication(deps: McpApplicationDeps): McpHttpApplication {
  async function workspacePathOr(workspaceId: string): Promise<string | null> {
    return deps.workspaces.getWorkspacePath(workspaceId);
  }
  function requirePath(workspaceId: string): string {
    const path = deps.workspaces.getWorkspacePath(workspaceId);
    if (path === null) throw new NotFoundError('Workspace not found');
    return path;
  }

  return {
    save: (id, name, config) => deps.lifecycle.saveServer(requirePath(id), name, config),
    remove: (id, name) => deps.lifecycle.removeServer(requirePath(id), name),
    tools: (id, name) => deps.lifecycle.getServerTools(requirePath(id), name),
    setToolEnabled: (id, name, toolName, enabled) => deps.lifecycle.setToolEnabled(requirePath(id), name, toolName, enabled),
    startAuth: (id, name, redirectUrl) => deps.lifecycle.startAuth(requirePath(id), name, redirectUrl),
    async finishAuth(state, code) {
      const result = await deps.lifecycle.finishAuth(state, code);
      return { status: result.status };
    },
    async finishWorkspaceAuth(id, name, state, code) {
      const result = await deps.lifecycle.finishAuth(state, code, { path: requirePath(id), name });
      return { status: result.status };
    },
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
