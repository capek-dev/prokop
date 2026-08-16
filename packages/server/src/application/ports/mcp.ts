import type { McpServerConfig, McpStatus } from '@jean2/sdk';

/**
 * Inward-facing MCP lifecycle port (S5). The MCP process, discovery,
 * stdio/HTTP/SSE, OAuth, and AI SDK conversion implementations stay at
 * their current paths (the conversion move is S7 work); this port carries
 * the lifecycle seam so routes and use cases never import the
 * implementation directly. The converted tool map stays opaque here: the
 * AI SDK tool type remains an implementation concern until S7.
 */

/** Opaque converted-tool map; the concrete AI SDK tool shape stays with
 * the MCP implementation until S7. */
export type McpToolMap = Record<string, unknown>;

export interface McpLifecyclePort {
  initializeWorkspace(workspacePath: string): Promise<void>;
  shutdownWorkspace(workspacePath: string): Promise<void>;
  connectServer(
    workspacePath: string,
    name: string,
    config: McpServerConfig,
  ): Promise<McpStatus>;
  disconnectServer(workspacePath: string, name: string): Promise<void>;
  getServerStatus(workspacePath: string, name: string): Promise<McpStatus | undefined>;
  getAllServerStatus(
    workspacePath: string,
  ): Promise<Record<string, { config: McpServerConfig | undefined; status: McpStatus }>>;
  getTools(workspacePath: string, sessionId: string): Promise<McpToolMap>;
  startAuth(workspacePath: string, name: string): Promise<{ authorizationUrl: string }>;
  finishAuth(workspacePath: string, name: string, code: string): Promise<McpStatus>;
  getMcpServers(workspacePath: string): Promise<Record<string, McpServerConfig>>;
}

/** Workspace path lookup for MCP use cases; the Jean2 adapter reads the
 * workspace store. */
export interface McpWorkspacePort {
  getWorkspacePath(workspaceId: string): string | null;
}
