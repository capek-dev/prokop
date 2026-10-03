import type { McpServerConfig, McpStatus, McpToolInfo } from '@prokopai/sdk';

/**
 * Workspace configuration, connections and OAuth owned by the host.
 * Routes depend on application use cases; harnesses consume neutral tools
 * through WorkspaceMcpToolsPort. Runtime-specific conversion stays outside
 * the connection manager.
 */

/** Compatibility seam for the Prokop tool conversion adapter. */
export type McpToolMap = Record<string, unknown>;

export interface McpLifecyclePort {
  /** A null workspacePath addresses global configuration and connections. */
  initializeWorkspace(workspacePath: string | null): Promise<void>;
  shutdownWorkspace(workspacePath: string | null): Promise<void>;
  connectServer(
    workspacePath: string | null,
    name: string,
    config: McpServerConfig,
  ): Promise<McpStatus>;
  disconnectServer(workspacePath: string | null, name: string): Promise<void>;
  getServerStatus(workspacePath: string | null, name: string): Promise<McpStatus | undefined>;
  getAllServerStatus(
    workspacePath: string | null,
  ): Promise<Record<string, { config: McpServerConfig | undefined; status: McpStatus }>>;
  getTools(workspacePath: string, sessionId: string): Promise<McpToolMap>;
  startAuth(workspacePath: string | null, name: string, redirectUrl: string): Promise<{ authorizationUrl: string }>;
  finishAuth(state: string, code: string, expected?: { path: string | null; name: string }): Promise<{ path: string | null; status: McpStatus }>;
  saveServer(workspacePath: string | null, name: string, config: McpServerConfig): Promise<void>;
  removeServer(workspacePath: string | null, name: string): Promise<void>;
  getServerTools(workspacePath: string | null, name: string): Promise<McpToolInfo[]>;
  setToolEnabled(workspacePath: string | null, name: string, toolName: string, enabled: boolean): Promise<void>;
  getMcpServers(workspacePath: string | null): Promise<Record<string, McpServerConfig>>;
}

/** Workspace path lookup for MCP use cases; the Jean2 adapter reads the
 * workspace store. */
export interface McpWorkspacePort {
  getWorkspacePath(workspaceId: string): string | null;
}
