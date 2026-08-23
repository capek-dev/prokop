import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveToolsPath, getDefaultToolsPath } from '@/config';
import { isBuiltinToolName } from '@/tools/builtin';
import { clearCache as clearToolsCache, downloadArtifact, verifyChecksum, extractArtifact, validateArtifactStructure, ArtifactError, readInstallManifest, writeInstallManifest, loadToolModule } from '@/adapters/capek/contracts';
import {
  buildSourceInstallManifest,
  buildUrlInstallManifest,
  defaultEntry,
  isPreviousEntry,
  isStagingEntry,
  PROTECTED_SDK_PACKAGE,
  readVersionValue,
  requireArtifactPackageJson,
  toolInstallDir,
  validateToolModuleExports,
  VERSION_FILE,
  type ToolInstallManifest,
} from '@/domains/tool-installation';
import { installDependencies, NpmInstallError } from './tool-npm-installer';
import { bundleTool } from './tool-bundler';

export type { InstallManifest } from '@/adapters/capek/contracts';

export interface InstallResult {
  success: boolean;
  toolName: string;
  version?: string;
  error?: string;
  stage?: string;
}

export interface InstalledTool {
  name: string;
  version: string | null;
  path: string;
}

export interface RemoveResult {
  success: boolean;
  toolName: string;
  error?: string;
}

function ensureToolsDir(toolsDir: string): string {
  if (!existsSync(toolsDir)) {
    mkdirSync(toolsDir, { recursive: true });
  }
  return toolsDir;
}

function getToolDir(toolsDir: string, toolName: string): string {
  return toolInstallDir(toolsDir, toolName);
}

function readVersion(toolDir: string): string | null {
  const versionPath = join(toolDir, VERSION_FILE);
  if (!existsSync(versionPath)) {
    return null;
  }
  try {
    return readVersionValue(readFileSync(versionPath, 'utf-8'));
  } catch {
    return null;
  }
}

async function validateToolModule(modulePath: string): Promise<{ name: string }> {
  try {
    const module = await import(modulePath);
    const name = validateToolModuleExports(module);
    return { name };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load tool module: ${message}`, { cause: err });
  }
}

export async function installTool(
  sourcePath: string,
  toolsDir: string,
): Promise<InstallResult> {
  ensureToolsDir(toolsDir);

  if (!existsSync(sourcePath)) {
    return {
      success: false,
      toolName: '',
      error: `Source path does not exist: ${sourcePath}`,
    };
  }

  const toolJsPath = join(sourcePath, 'tool.js');
  const toolTsPath = join(sourcePath, 'tool.ts');
  if (!existsSync(toolJsPath) && !existsSync(toolTsPath)) {
    return {
      success: false,
      toolName: '',
      error: 'Source directory must contain tool.js or tool.ts',
    };
  }
  const modulePath = existsSync(toolJsPath) ? toolJsPath : toolTsPath;

  let sdkVersion: string | undefined;
  let sdkIntegrity: string | undefined;

  try {
    const installResult = await installDependencies({ toolDir: sourcePath });
    sdkVersion = installResult.protectedVersions?.[PROTECTED_SDK_PACKAGE]?.version;
    sdkIntegrity = installResult.protectedVersions?.[PROTECTED_SDK_PACKAGE]?.integrity ?? undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      toolName: '',
      error: message,
      stage: 'npm-install',
    };
  }

  let toolName: string;

  try {
    const validated = await validateToolModule(modulePath);
    toolName = validated.name;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      toolName: '',
      error: message,
      stage: 'validate',
    };
  }

  if (isBuiltinToolName(toolName)) {
    return {
      success: false,
      toolName,
      error: `"${toolName}" is a built-in tool. Built-ins always win; an installed copy of the same name would be shadowed. Pick a different tool name.`,
      stage: 'validate',
    };
  }

  const finalDir = getToolDir(toolsDir, toolName);
  const stagingDir = finalDir + '.staging';

  if (existsSync(stagingDir)) {
    rmSync(stagingDir, { recursive: true, force: true });
  }

  mkdirSync(stagingDir, { recursive: true });

  cpSync(sourcePath, stagingDir, { recursive: true });

  const version = readVersion(stagingDir);

  const manifest: ToolInstallManifest = buildSourceInstallManifest({
    toolName,
    version,
    installedAt: new Date().toISOString(),
    sourcePath,
    entry: defaultEntry(existsSync(toolJsPath)),
    sdkVersion,
    sdkIntegrity,
  });
  writeInstallManifest(stagingDir, manifest);

  if (existsSync(finalDir)) {
    const backupDir = finalDir + '.previous';
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }
    renameSync(finalDir, backupDir);
  }

  try {
    renameSync(stagingDir, finalDir);
  } catch (err: unknown) {
    const backupDir = finalDir + '.previous';
    if (existsSync(backupDir)) {
      try {
        renameSync(backupDir, finalDir);
      } catch {
        // best effort rollback
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      toolName,
      error: `Atomic move failed: ${message}`,
      stage: 'finalize',
    };
  }

  const backupDir = finalDir + '.previous';
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }

  clearToolsCache();

  return {
    success: true,
    toolName,
    version: version || undefined,
  };
}

export interface InstallFromUrlOptions {
  url: string;
  toolName: string;
  toolsDir: string;
  entry?: string;
  artifactSha256?: string;
}

export async function installToolFromUrl(
  url: string,
  toolName: string,
  toolsDir: string,
  options?: { entry?: string; artifactSha256?: string },
): Promise<InstallResult> {
  const entry = options?.entry ?? 'tool.ts';
  const artifactSha256 = options?.artifactSha256;

  ensureToolsDir(toolsDir);

  const tempDir = join(tmpdir(), `jean2-install-${Date.now()}-${toolName}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const { archivePath } = await downloadArtifact(url, tempDir);
    await verifyChecksum(archivePath, artifactSha256);

    const extractedRoot = await extractArtifact(archivePath, tempDir);

    const validation = validateArtifactStructure(extractedRoot, entry);
    if (!requireArtifactPackageJson(validation)) {
      return {
        success: false,
        toolName,
        error: 'Artifact missing package.json',
        stage: 'validate',
      };
    }

    let sdkVersionFromUrl: string | undefined;
    let sdkIntegrityFromUrl: string | undefined;

    try {
      const installResult = await installDependencies({ toolDir: extractedRoot });
      sdkVersionFromUrl = installResult.protectedVersions?.[PROTECTED_SDK_PACKAGE]?.version;
      sdkIntegrityFromUrl = installResult.protectedVersions?.[PROTECTED_SDK_PACKAGE]?.integrity ?? undefined;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        toolName,
        error: message,
        stage: 'npm-install',
      };
    }

    // Bundle tool.ts -> tool.js (inlines all deps so import() works in compiled binary)
    let bundledEntry = entry;
    try {
      await bundleTool(extractedRoot, entry);
      bundledEntry = 'tool.js';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        toolName,
        error: message,
        stage: 'validate',
      };
    }

    let resolvedToolName: string;
    try {
      resolvedToolName = await resolveToolNameFromModule(extractedRoot, bundledEntry);
    } catch (err: unknown) {
      return {
        success: false,
        toolName,
        error: err instanceof Error ? err.message : String(err),
        stage: 'validate',
      };
    }

    if (isBuiltinToolName(resolvedToolName)) {
      return {
        success: false,
        toolName: resolvedToolName,
        error: `"${resolvedToolName}" is a built-in tool. Built-ins always win; an installed copy of the same name would be shadowed. Pick a different tool name.`,
        stage: 'validate',
      };
    }

    const finalDir = getToolDir(toolsDir, resolvedToolName);
    const stagingDir = finalDir + '.staging';

    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }

    mkdirSync(stagingDir, { recursive: true });

    cpSync(extractedRoot, stagingDir, {
      recursive: true,
      filter: (src) => {
        const basename = src.split('/').pop() || '';
        return !basename.startsWith('.install-temp');
      },
    });

  const version = readVersion(stagingDir);

  const manifest: ToolInstallManifest = buildUrlInstallManifest({
    toolName: resolvedToolName,
    version,
    installedAt: new Date().toISOString(),
    sourceUrl: url,
    artifactSha256,
    entry: bundledEntry,
    sdkVersion: sdkVersionFromUrl,
    sdkIntegrity: sdkIntegrityFromUrl,
  });
  writeInstallManifest(stagingDir, manifest);

    if (existsSync(finalDir)) {
      const backupDir = finalDir + '.previous';
      if (existsSync(backupDir)) {
        rmSync(backupDir, { recursive: true, force: true });
      }
      renameSync(finalDir, backupDir);
    }

    try {
      renameSync(stagingDir, finalDir);
    } catch (err: unknown) {
      const backupDir = finalDir + '.previous';
      if (existsSync(backupDir)) {
        try {
          renameSync(backupDir, finalDir);
        } catch {
          // best effort rollback
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        toolName: resolvedToolName,
        error: `Atomic move failed: ${message}`,
        stage: 'finalize',
      };
    }

    const backupDir = finalDir + '.previous';
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
    }

    clearToolsCache();

    return {
      success: true,
      toolName: resolvedToolName,
      version: version || undefined,
    };
  } catch (err: unknown) {
    if (err instanceof ArtifactError) {
      return {
        success: false,
        toolName,
        error: err.message,
        stage: err.stage,
      };
    }
    if (err instanceof NpmInstallError) {
      return {
        success: false,
        toolName,
        error: err.message,
        stage: 'npm-install',
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      toolName,
      error: message,
    };
  } finally {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function resolveToolNameFromModule(
  toolDir: string,
  entry: string,
): Promise<string> {
  const modulePath = join(toolDir, entry);

  try {
    const module = await import(modulePath);
    return validateToolModuleExports(module);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Module validation failed: ${message}`, { cause: err });
  }
}

export async function removeTool(
  toolName: string,
  toolsDir: string,
): Promise<RemoveResult> {
  const toolDir = getToolDir(toolsDir, toolName);

  if (!existsSync(toolDir)) {
    return {
      success: false,
      toolName,
      error: `Tool ${toolName} is not installed`,
    };
  }

  rmSync(toolDir, { recursive: true, force: true });

  const backupDir = toolDir + '.previous';
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }

  clearToolsCache();

  return {
    success: true,
    toolName,
  };
}

export async function getInstalledTools(
  toolsDir: string,
): Promise<InstalledTool[]> {
  if (!existsSync(toolsDir)) {
    return [];
  }

  const tools: InstalledTool[] = [];

  try {
    const entries = readdirSync(toolsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isStagingEntry(entry.name) || isPreviousEntry(entry.name)) continue;

      const toolName = entry.name;
      const toolDir = join(toolsDir, toolName);

      const manifest = readInstallManifest(toolsDir, toolName);
      const loadedTool = await loadToolModule(toolDir);
      if (!loadedTool) continue;

      const version = readVersion(toolDir) ||
        manifest?.toolVersion ||
        null;

      tools.push({
        name: toolName,
        version,
        path: toolDir,
      });
    }
  } catch {
    return [];
  }

  return tools;
}

export async function isToolInstalled(
  toolName: string,
  toolsDir: string,
): Promise<boolean> {
  const toolDir = getToolDir(toolsDir, toolName);
  if (!existsSync(toolDir)) {
    return false;
  }
  const toolJsPath = join(toolDir, 'tool.js');
  const toolTsPath = join(toolDir, 'tool.ts');
  return existsSync(toolJsPath) || existsSync(toolTsPath);
}

export async function getInstalledToolVersion(
  toolName: string,
  toolsDir: string,
): Promise<string | null> {
  const toolDir = getToolDir(toolsDir, toolName);
  const version = readVersion(toolDir);
  if (version !== null) {
    return version;
  }

  const manifest = readInstallManifest(toolsDir, toolName);
  return manifest?.toolVersion ?? null;
}

export function getToolInstallDir(toolName: string): string {
  return getToolDir(resolveToolsPath(), toolName);
}

export function getToolsBaseDir(): string {
  return resolveToolsPath();
}

export function getDefaultToolsBaseDir(): string {
  return getDefaultToolsPath();
}

export function clearCache(): void {
  clearToolsCache();
}
