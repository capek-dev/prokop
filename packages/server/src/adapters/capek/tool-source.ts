import {
  configureToolSource,
  configureToolsPath,
  type ToolSourceLifecycle,
} from '@capekai/core/compat/jean2';
import { resolveToolsPath } from '@/config';
import { getTools, initializeWorkspace } from '@/mcp';
import { getToolsDir } from '@/paths';

export const jean2ToolSource: ToolSourceLifecycle = {
  initializeWorkspace,
  discoverTools: getTools,
};

export function configureJean2ToolSource(): void {
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(process.env.JEAN2_TOOLS_PATH || getToolsDir());
  }
  configureToolSource(jean2ToolSource);
}
