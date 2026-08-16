import { createMcpLifecycle } from '@/infrastructure/mcp/lifecycle';
import { getWorkspace } from '@/store/workspaces';
import type { McpLifecyclePort, McpWorkspacePort } from '@/application/ports/mcp';

/**
 * Jean2 MCP lifecycle adapter (S5). Wraps the current MCP manager with its
 * exact identities (process, discovery, stdio/HTTP/SSE, OAuth, and AI SDK
 * conversion stay at their current paths until S7); the workspace lookup
 * reads the workspace store.
 */

export function createJean2McpLifecyclePort(): McpLifecyclePort {
  return createMcpLifecycle();
}

export function createJean2McpWorkspacePort(): McpWorkspacePort {
  return {
    getWorkspacePath(workspaceId) {
      return getWorkspace(workspaceId)?.path ?? null;
    },
  };
}
