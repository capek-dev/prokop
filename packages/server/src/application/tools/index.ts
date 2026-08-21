import type { LoadedTool, ToolDefinition, ToolEnvVarStatus } from '@prokopai/sdk';
import type {
  ToolCatalogPort,
  ToolEnvironmentPort,
  ToolEnvStatus,
} from '../ports/tool-distribution';

/**
 * Tool HTTP use cases (S4). Owns the route-level behavior for the tools
 * endpoints: the list failure fallback to an empty catalog, the env
 * listing/setting outcome mapping, and the set-value trimming. Transport
 * maps the discriminated results to HTTP statuses exactly as before.
 */

export interface ToolsApplicationDeps {
  catalog: ToolCatalogPort;
  environment: ToolEnvironmentPort;
}

export type ToolListResult = { kind: 'ok'; tools: ToolDefinition[] };
export type ToolGetResult = { kind: 'ok'; tool: LoadedTool } | { kind: 'missing' };
export type ToolEnvListResult =
  | { kind: 'ok'; status: ToolEnvStatus }
  | { kind: 'failed'; message: string };
export type ToolEnvSetResult =
  | { kind: 'ok'; envVar: ToolEnvVarStatus }
  | { kind: 'invalid'; message: string }
  | { kind: 'failed'; message: string };

export interface ToolsHttpApplication {
  listTools(): Promise<ToolListResult>;
  getTool(name: string): Promise<ToolGetResult>;
  listEnv(): Promise<ToolEnvListResult>;
  setEnv(key: string, value: string): Promise<ToolEnvSetResult>;
}

export function createToolsHttpApplication(deps: ToolsApplicationDeps): ToolsHttpApplication {
  return {
    async listTools() {
      try {
        const tools = await deps.catalog.listTools();
        return { kind: 'ok', tools };
      } catch {
        return { kind: 'ok', tools: [] };
      }
    },

    async getTool(name) {
      const tool = await deps.catalog.getTool(name);
      return tool ? { kind: 'ok', tool } : { kind: 'missing' };
    },

    async listEnv() {
      const result = await deps.environment.listToolEnvVars();
      return result.ok ? { kind: 'ok', status: result.status } : { kind: 'failed', message: result.message };
    },

    async setEnv(key, value) {
      const result = await deps.environment.setToolEnvVar(key, value.trim());
      if (result.ok) {
        return { kind: 'ok', envVar: result.envVar };
      }
      return result.kind === 'invalid'
        ? { kind: 'invalid', message: result.message }
        : { kind: 'failed', message: result.message };
    },
  };
}
