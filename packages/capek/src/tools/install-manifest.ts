import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { InstallManifest } from '@capekai/tool';

export type { InstallManifest };

const INSTALL_MANIFEST = '.install-manifest.json';

function isInstallManifest(data: unknown): data is InstallManifest {
  if (typeof data !== 'object' || data === null) return false;
  const value = data as Record<string, unknown>;
  return typeof value.toolName === 'string'
    && (value.toolVersion === null || typeof value.toolVersion === 'string')
    && typeof value.installedAt === 'string'
    && typeof value.entry === 'string'
    && typeof value.runtime === 'string';
}

export function readInstallManifest(toolsDir: string, toolName: string): InstallManifest | null {
  const manifestPath = join(toolsDir, toolName, INSTALL_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (!isInstallManifest(parsed)) {
      console.warn(`[install-manifest] Invalid manifest for ${toolName}: missing required fields`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeInstallManifest(toolDir: string, manifest: InstallManifest): void {
  writeFileSync(getManifestPath(toolDir), JSON.stringify(manifest, null, 2));
}

export function getManifestPath(toolDir: string): string {
  return join(toolDir, INSTALL_MANIFEST);
}
