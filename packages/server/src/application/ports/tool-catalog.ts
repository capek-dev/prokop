import type { LoadedTool, ToolDefinition, ToolEnvVarStatus } from '@prokopai/sdk';

/** Catalog entry exposed to the tools route. Built-ins and domain tools win
 * over same-named external directory tools, so a name appears at most once. */
export type ToolCatalogEntry = ToolDefinition & {
  source: 'builtin' | 'installed' | 'domain';
};

export interface ToolCatalogPort {
  listTools(): Promise<ToolCatalogEntry[]>;
  getTool(name: string): Promise<LoadedTool | null>;
}

export interface ToolEnvStatus {
  envVars: ToolEnvVarStatus[];
}

export type ToolEnvListPortResult =
  | { ok: true; status: ToolEnvStatus }
  | { ok: false; message: string };

export type ToolEnvSetPortResult =
  | { ok: true; envVar: ToolEnvVarStatus }
  | { ok: false; kind: 'invalid' | 'failed'; message: string };

export interface ToolEnvironmentPort {
  listToolEnvVars(): Promise<ToolEnvListPortResult>;
  setToolEnvVar(key: string, value: string): Promise<ToolEnvSetPortResult>;
}
