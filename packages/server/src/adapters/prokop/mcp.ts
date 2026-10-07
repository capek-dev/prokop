import { createMcpLifecycle } from '@/infrastructure/mcp/lifecycle';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import type { McpLifecyclePort, McpWorkspacePort } from '@/application/ports/mcp';

/**
 * Prokop MCP lifecycle adapter (S5). Wraps the current MCP manager with its
 * exact identities (process, discovery, stdio/HTTP/SSE, OAuth, and AI SDK
 * conversion stay at their current paths until S7); the workspace lookup
 * reads the workspace store.
 */

export function createProkopMcpLifecyclePort(): McpLifecyclePort {
  return createMcpLifecycle();
}

export function createProkopMcpWorkspacePort(): McpWorkspacePort {
  return {
    getWorkspacePath(workspaceId) {
      return getWorkspace(workspaceId)?.path ?? null;
    },
  };
}
