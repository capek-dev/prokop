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
import { builtinTools } from '@/tools/builtin';

/** The Jean2 workspace tool discovery: the MCP manager's per-workspace
 * client lifecycle and tool listing. */
export const jean2WorkspaceToolDiscovery: WorkspaceToolDiscovery = {
  initializeWorkspace,
  discoverTools: getTools,
};

/** Capek tool catalog seam for the tools route (S4): the Jean2 tools
 * adapter consumes this so no non-Capek adapter imports the compat
 * barrel. Merges the baked-in baseline above the installed registry:
 * built-ins win on name collision (the scoped resolver enforces the
 * same precedence at execution time). */
export const jean2ToolCatalog = {
  listTools: async () => {
    const installed = await capekListTools();
    const builtinNames = new Set(builtinTools.map((tool) => tool.definition.name));
    const definitions = [
      ...builtinTools.map((tool) => tool.definition),
      ...installed.filter((definition) => !builtinNames.has(definition.name)),
    ];
    return definitions.sort((a, b) => a.name.localeCompare(b.name));
  },
  getTool: async (name: string) => {
    const builtin = builtinTools.find((tool) => tool.definition.name === name);
    if (builtin) return builtin;
    return capekGetTool(name);
  },
};

export function configureJean2WorkspaceToolDiscovery(): void {
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(readEnv('TOOLS_PATH') || getToolsDir());
  }
  configureWorkspaceToolDiscovery(jean2WorkspaceToolDiscovery);
}
