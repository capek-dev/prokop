import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tool } from 'ai';

/**
 * Per-workspace dynamic tool discovery seam. The workspacePath is a scoping
 * key for discovery (for example, which MCP servers are configured for that
 * workspace), not a directory tools are stored in: installed tool packages
 * resolve through the tools directory registry, not through this contract.
 */
export interface WorkspaceToolDiscovery {
  initializeWorkspace?(workspacePath: string): Promise<void>;
  discoverTools?(workspacePath: string, sessionId?: string): Promise<Record<string, Tool>>;
}

const defaultWorkspaceToolDiscovery: Required<WorkspaceToolDiscovery> = {
  async initializeWorkspace(): Promise<void> {},
  async discoverTools(): Promise<Record<string, Tool>> {
    return {};
  },
};

let workspaceToolDiscovery: WorkspaceToolDiscovery = defaultWorkspaceToolDiscovery;
const scopedWorkspaceToolDiscovery = new AsyncLocalStorage<WorkspaceToolDiscovery>();

function activeWorkspaceToolDiscovery(): WorkspaceToolDiscovery {
  return scopedWorkspaceToolDiscovery.getStore() ?? workspaceToolDiscovery;
}

export function withWorkspaceToolDiscovery<T>(
  discovery: WorkspaceToolDiscovery,
  callback: () => T,
): T {
  return scopedWorkspaceToolDiscovery.run(discovery, callback);
}

export function configureWorkspaceToolDiscovery(discovery?: WorkspaceToolDiscovery): void {
  workspaceToolDiscovery = discovery ?? defaultWorkspaceToolDiscovery;
}

export function getWorkspaceToolDiscovery(): WorkspaceToolDiscovery {
  return activeWorkspaceToolDiscovery();
}

export async function initializeWorkspaceDiscovery(workspacePath: string): Promise<void> {
  await activeWorkspaceToolDiscovery().initializeWorkspace?.(workspacePath);
}

export async function discoverWorkspaceTools(
  workspacePath: string,
  sessionId?: string,
): Promise<Record<string, Tool>> {
  return await activeWorkspaceToolDiscovery().discoverTools?.(workspacePath, sessionId) ?? {};
}
