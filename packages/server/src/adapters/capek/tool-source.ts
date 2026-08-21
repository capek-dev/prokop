import {
  configureToolsPath,
  configureWorkspaceToolDiscovery,
  getTool as capekGetTool,
  listTools as capekListTools,
  type WorkspaceToolDiscovery,
} from '@capekai/core/tools';
import { resolveToolsPath } from '@/config';
import { getTools, initializeWorkspace } from '@/infrastructure/mcp';
import { getToolsDir } from '@/infrastructure/runtime/paths';
import { readEnv } from '@/infrastructure/runtime/env-compat';

/** The Jean2 workspace tool discovery: the MCP manager's per-workspace
 * client lifecycle and tool listing. */
export const jean2WorkspaceToolDiscovery: WorkspaceToolDiscovery = {
  initializeWorkspace,
  discoverTools: getTools,
};

/** Capek tool catalog seam for the tools route (S4): the Jean2 tools
 * adapter consumes this so no non-Capek adapter imports the compat
 * barrel. */
export const jean2ToolCatalog = {
  listTools: capekListTools,
  getTool: capekGetTool,
};

export function configureJean2WorkspaceToolDiscovery(): void {
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(readEnv('TOOLS_PATH') || getToolsDir());
  }
  configureWorkspaceToolDiscovery(jean2WorkspaceToolDiscovery);
}
