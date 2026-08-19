import {
  configureToolSource,
  configureToolsPath,
  getTool as capekGetTool,
  listTools as capekListTools,
  type ToolSourceLifecycle,
} from '@capekai/core/tools';
import { resolveToolsPath } from '@/config';
import { getTools, initializeWorkspace } from '@/infrastructure/mcp';
import { getToolsDir } from '@/infrastructure/runtime/paths';

export const jean2ToolSource: ToolSourceLifecycle = {
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

export function configureJean2ToolSource(): void {
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(process.env.JEAN2_TOOLS_PATH || getToolsDir());
  }
  configureToolSource(jean2ToolSource);
}
