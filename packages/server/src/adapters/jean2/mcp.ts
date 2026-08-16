import * as mcp from '@/mcp';
import { getWorkspace } from '@/store/workspaces';
import type { McpLifecyclePort, McpWorkspacePort } from '@/application/ports/mcp';

/**
 * Jean2 MCP lifecycle adapter (S5). Wraps the current MCP manager with its
 * exact identities (process, discovery, stdio/HTTP/SSE, OAuth, and AI SDK
 * conversion stay at their current paths until S7); the workspace lookup
 * reads the workspace store.
 */

export function createJean2McpLifecyclePort(): McpLifecyclePort {
  return {
    initializeWorkspace: mcp.initializeWorkspace,
    shutdownWorkspace: mcp.shutdownWorkspace,
    connectServer: mcp.connectServer,
    disconnectServer: mcp.disconnectServer,
    getServerStatus: mcp.getServerStatus,
    getAllServerStatus: mcp.getAllServerStatus,
    getTools: mcp.getTools as unknown as McpLifecyclePort['getTools'],
    startAuth: mcp.startAuth,
    finishAuth: mcp.finishAuth,
    getMcpServers: mcp.getMcpServers,
  };
}

export function createJean2McpWorkspacePort(): McpWorkspacePort {
  return {
    getWorkspacePath(workspaceId) {
      return getWorkspace(workspaceId)?.path ?? null;
    },
  };
}
