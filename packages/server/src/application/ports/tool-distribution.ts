import type { LoadedTool, ToolDefinition, ToolEnvVarStatus } from '@prokopai/sdk';
import type {
  RepositoryTool,
  ToolEnvVar,
  ToolRepository,
} from '@/domains/tool-installation';

/**
 * Inward-facing tool distribution ports (S4/S5). The installation metadata
 * and release policy lives in the tool-installation domain
 * (`@/domains/tool-installation`); these ports carry the filesystem,
 * network, npm, bundling, catalog, and environment seams. The Jean2
 * adapters wrap the current `tools/` and `configuration/` implementations.
 */

export interface ToolInstallResult {
  success: boolean;
  toolName: string;
  version?: string;
  error?: string;
  stage?: string;
}

export interface InstalledToolRecord {
  name: string;
  version: string | null;
  path: string;
}

export interface ToolRemoveResult {
  success: boolean;
  toolName: string;
  error?: string;
}

export interface ToolDistributionPort {
  installTool(sourcePath: string, toolsDir: string): Promise<ToolInstallResult>;
  installToolFromUrl(
    url: string,
    toolName: string,
    toolsDir: string,
    options?: { entry?: string; artifactSha256?: string },
  ): Promise<ToolInstallResult>;
  removeTool(toolName: string, toolsDir: string): Promise<ToolRemoveResult>;
  getInstalledTools(toolsDir: string): Promise<InstalledToolRecord[]>;
  isToolInstalled(toolName: string, toolsDir: string): Promise<boolean>;
  getInstalledToolVersion(toolName: string, toolsDir: string): Promise<string | null>;
  clearCache(): void;
  toolsBaseDir(): string;
  defaultToolsBaseDir(): string;
  toolInstallDir(toolName: string): string;
}

export interface ToolRepositoryPort {
  fetchRepository(): Promise<ToolRepository>;
  fetchRepositoryWithVersions(): Promise<RepositoryTool[]>;
  collectEnvVars(toolName: string): Promise<ToolEnvVarStatus[]>;
  getToolByName(toolName: string): Promise<RepositoryTool | null>;
}

/** Catalog of installed tools exposed to the tools route. */
export interface ToolCatalogPort {
  listTools(): Promise<ToolDefinition[]>;
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

export type { ToolEnvVar };
