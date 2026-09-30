import {
  configureToolsPath,
  configureWorkspaceToolDiscovery,
  getTool as capekGetTool,
  listTools as capekListTools,
  type WorkspaceToolDiscovery,
} from '@capekai/core/tools';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';
import { resolveToolsPath } from '@/config';
import type { ToolCatalogEntry } from '@/application/ports/tool-catalog';
import { getTools, initializeWorkspace } from '@/infrastructure/mcp';
import { getToolsDir } from '@/infrastructure/runtime/paths';
import { readEnv } from '@/infrastructure/runtime/env-compat';
import type { LoadedTool } from '@capekai/tool';
import { getBuiltinToolsPort } from '@/application/ports/builtin-tools';

/** Harness-owned built-ins, read through the installed port at call time
 * so this adapter never imports harness internals. */
function exposedBuiltinTools(): readonly LoadedTool[] {
  return getBuiltinToolsPort()?.tools() ?? [];
}

/** The Jean2 workspace tool discovery: the MCP manager's per-workspace
 * client lifecycle and tool listing. */
export const jean2WorkspaceToolDiscovery: WorkspaceToolDiscovery = {
  initializeWorkspace,
  discoverTools: getTools,
};

/** Capek tool catalog seam for the tools route (S4): the Jean2 tools
 * adapter consumes this so no non-Capek adapter imports the compat
 * barrel. Merges the baked-in baseline and the capek domain tools above
 * the installed registry: built-ins win on name collision (the scoped
 * resolver enforces the same precedence at execution time). */
export const jean2ToolCatalog = {
  listTools: async (): Promise<ToolCatalogEntry[]> => {
    const builtins = exposedBuiltinTools();
    const installed = await capekListTools();
    const builtinNames = new Set(builtins.map((tool) => tool.definition.name));
    const domains = listDomainToolFallbackDefinitions()
      .map((definition) => ({ ...definition, source: 'domain' as const }));
    const domainNames = new Set(domains.map((tool) => tool.name));
    return [
      ...builtins.map((tool) => ({ ...tool.definition, source: 'builtin' as const })),
      ...domains.filter((tool) => !builtinNames.has(tool.name)),
      ...installed
        .filter((definition) => (
          !builtinNames.has(definition.name)
          && !domainNames.has(definition.name)
        ))
        .map((definition) => ({ ...definition, source: 'installed' as const })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  },
  getTool: async (name: string) => {
    const builtin = exposedBuiltinTools().find((tool) => tool.definition.name === name);
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
