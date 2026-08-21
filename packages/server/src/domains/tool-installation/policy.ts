import { join } from 'path';
import type { InstallManifest } from '@capekai/tool';

/**
 * Tool-installation domain: tool installation metadata and release policy.
 *
 * Owns the rules for installed-tool layout, versioning, staging, manifest
 * construction, module shape validation, and failure staging. The
 * filesystem, network, bundling, and npm implementations stay in
 * `tools/`/infrastructure and consume these rules; this module imports no
 * fs, network, process, or Capek code.
 */

export const VERSION_FILE = 'VERSION';
export const STAGING_SUFFIX = '.staging';
export const PREVIOUS_SUFFIX = '.previous';

export const INSTALL_STRATEGY_SOURCE_NPM = 'source+npm';
export const INSTALL_STRATEGY_SOURCE_NPM_BUNDLE = 'source+npm+bundle';
export const TOOL_RUNTIME = 'bun';

/** The SDK package whose resolved version and integrity are recorded in the
 * install manifest. */
export const PROTECTED_SDK_PACKAGE = '@prokopai/sdk';

export type InstallStage = 'npm-install' | 'validate' | 'finalize';

/** Directory layout: `<toolsDir>/<toolName>` with staging and backup
 * siblings derived from the same name. */
export function toolInstallDir(toolsDir: string, toolName: string): string {
  return join(toolsDir, toolName);
}

export function isStagingEntry(name: string): boolean {
  return name.endsWith(STAGING_SUFFIX);
}

export function isPreviousEntry(name: string): boolean {
  return name.endsWith(PREVIOUS_SUFFIX);
}

/** Version file policy: trimmed content, empty content reads as null. */
export function readVersionValue(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** The entry file policy: bundled `tool.js` wins, source `tool.ts` falls
 * back. */
export function defaultEntry(hasToolJs: boolean): 'tool.js' | 'tool.ts' {
  return hasToolJs ? 'tool.js' : 'tool.ts';
}

/**
 * Module shape validation for installed tool entries. The caller loads the
 * module (loading is an implementation concern); this function owns the
 * export contract and the exact error messages.
 */
export function validateToolModuleExports(module: unknown): string {
  const candidate = module as { definition?: { name?: unknown }; execute?: unknown };
  if (!candidate?.definition || typeof candidate.execute !== 'function') {
    throw new Error('Tool must export "definition" and "execute"');
  }
  const name = candidate.definition.name;
  if (!name || typeof name !== 'string') {
    throw new Error('tool.definition.name is required');
  }
  return name;
}

/** Structural install-manifest record. The fs implementation persists it;
 * the domain owns its exact shape. */
export interface ToolInstallManifest {
  toolName: string;
  toolVersion: string | null;
  installedAt: string;
  sourcePath?: string;
  sourceUrl?: string;
  artifactSha256?: string;
  entry: string;
  runtime: InstallManifest['runtime'];
  installStrategy: InstallManifest['installStrategy'];
  sdkVersion?: string;
  sdkIntegrity?: string;
}

export function buildSourceInstallManifest(input: {
  toolName: string;
  version: string | null;
  installedAt: string;
  sourcePath: string;
  entry: string;
  sdkVersion?: string;
  sdkIntegrity?: string;
}): ToolInstallManifest {
  return {
    toolName: input.toolName,
    toolVersion: input.version,
    installedAt: input.installedAt,
    sourcePath: input.sourcePath,
    entry: input.entry,
    runtime: TOOL_RUNTIME,
    installStrategy: INSTALL_STRATEGY_SOURCE_NPM,
    ...(input.sdkVersion !== undefined && { sdkVersion: input.sdkVersion }),
    ...(input.sdkIntegrity !== undefined && { sdkIntegrity: input.sdkIntegrity }),
  };
}

export function buildUrlInstallManifest(input: {
  toolName: string;
  version: string | null;
  installedAt: string;
  sourceUrl: string;
  artifactSha256?: string;
  entry: string;
  sdkVersion?: string;
  sdkIntegrity?: string;
}): ToolInstallManifest {
  return {
    toolName: input.toolName,
    toolVersion: input.version,
    installedAt: input.installedAt,
    sourceUrl: input.sourceUrl,
    ...(input.artifactSha256 !== undefined && { artifactSha256: input.artifactSha256 }),
    entry: input.entry,
    runtime: TOOL_RUNTIME,
    installStrategy: INSTALL_STRATEGY_SOURCE_NPM_BUNDLE,
    ...(input.sdkVersion !== undefined && { sdkVersion: input.sdkVersion }),
    ...(input.sdkIntegrity !== undefined && { sdkIntegrity: input.sdkIntegrity }),
  };
}

/** Artifact structure policy: a downloadable tool artifact must contain a
 * package.json to be installable. */
export function requireArtifactPackageJson(validation: { hasPackageJson: boolean }): boolean {
  return validation.hasPackageJson;
}
