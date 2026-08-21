/**
 * Centralized Path Resolution
 *
 * All data directory paths are resolved through a singleton Paths instance.
 * In production, the data directory defaults to ~/.prokopai, falling back to
 * ~/.jean2 (legacy, deprecated) when only that exists.
 * It can be overridden via:
 *   - PROKOPAI_DATA_DIR (or legacy JEAN2_DATA_DIR) environment variable
 *   - Paths.configure({ dataDir }) (e.g. for CLI --data-dir flag, or tests)
 *
 * Usage:
 *   import { getAuthTokenPath, getPreconfigsDir } from '@/infrastructure/runtime/paths';
 *
 * Override (generic — not test-specific):
 *   import { Paths } from '@/infrastructure/runtime/paths';
 *   Paths.configure({ dataDir: '/tmp/some-dir' });
 *   Paths.reset();
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export const PROKOPAI_DIR_NAME = '.prokopai';
export const LEGACY_JEAN2_DIR_NAME = '.jean2';

function getProkopaiHomeDir(): string {
  return join(homedir(), PROKOPAI_DIR_NAME);
}

function getLegacyJean2HomeDir(): string {
  return join(homedir(), LEGACY_JEAN2_DIR_NAME);
}

/**
 * Default data-dir resolution with legacy fallback:
 *   ~/.prokopai exists → it (legacy dir is never read)
 *   ~/.jean2 exists    → it, with a one-time deprecation notice
 *   neither            → ~/.prokopai (created on demand by init)
 *
 * Memoized until Paths.reset() so repeated getDataDir() calls stay cheap.
 */
function resolveDefaultDataDir(): string {
  const prokopai = getProkopaiHomeDir();
  if (existsSync(prokopai)) {
    return prokopai;
  }

  const legacy = getLegacyJean2HomeDir();
  if (existsSync(legacy)) {
    console.warn(
      `[prokopai] Using legacy data directory ${legacy}. ` +
        `Run \`prokopai migrate\` to move it to ${prokopai}.`,
    );
    return legacy;
  }

  return prokopai;
}

let defaultDataDirCache: string | null = null;

class PathsSingleton {
  private dataDirOverride: string | null = null;

  /**
   * Configure the paths instance.
   * Currently supports overriding the root data directory.
   */
  configure(opts: { dataDir: string }): void {
    this.dataDirOverride = opts.dataDir;
  }

  /**
   * Reset all overrides to defaults.
   */
  reset(): void {
    this.dataDirOverride = null;
    defaultDataDirCache = null;
  }

  /**
   * Get the root data directory.
   * Priority:
   *   1. Programmatic override (set via configure)
   *   2. PROKOPAI_DATA_DIR (or legacy JEAN2_DATA_DIR) env var
   *   3. Default: ~/.prokopai, or ~/.jean2 when only the legacy dir exists
   */
  getDataDir(): string {
    if (this.dataDirOverride) {
      return this.dataDirOverride;
    }

    const envDir = process.env.PROKOPAI_DATA_DIR ?? process.env.JEAN2_DATA_DIR;
    if (envDir) {
      return envDir;
    }

    if (!defaultDataDirCache) {
      defaultDataDirCache = resolveDefaultDataDir();
    }
    return defaultDataDirCache;
  }

  // ── Top-level files ────────────────────────────────────────────

  getConfigPath(): string {
    return join(this.getDataDir(), 'config.json');
  }

  getModelsConfigPath(): string {
    return join(this.getDataDir(), 'models.json');
  }

  getEnvFilePath(): string {
    return join(this.getDataDir(), '.env');
  }

  getAuthTokenPath(): string {
    return join(this.getDataDir(), 'auth-token.json');
  }

  getWebPushCredentialsPath(): string {
    return join(this.getDataDir(), 'web-push.json');
  }

  getMcpAuthPath(): string {
    return join(this.getDataDir(), 'mcp-auth.json');
  }

  getGlobalAgentsPath(): string {
    return join(this.getDataDir(), 'AGENTS.md');
  }

  getPidFilePath(): string {
    return join(this.getDataDir(), 'server.pid');
  }

  getLogFilePath(): string {
    return join(this.getDataDir(), 'server.log');
  }

  // ── Directories ────────────────────────────────────────────────

  getDatabaseDir(): string {
    return join(this.getDataDir(), 'data');
  }

  getDefaultDatabasePath(): string {
    return join(this.getDatabaseDir(), 'agent.db');
  }

  getUploadDir(): string {
    return join(this.getDataDir(), 'data', 'upload');
  }

  getAttachmentDir(workspaceId: string, sessionId: string): string {
    return join(this.getUploadDir(), workspaceId, sessionId);
  }

  getToolsDir(): string {
    return join(this.getDataDir(), 'tools');
  }

  getPreconfigsDir(): string {
    return join(this.getDataDir(), 'preconfigs');
  }

  getPromptsDir(): string {
    return join(this.getDataDir(), 'prompts');
  }

  getProvidersDir(): string {
    return join(this.getDataDir(), 'providers');
  }

  getProviderPath(provider: string): string {
    return join(this.getProvidersDir(), `${provider}.json`);
  }

  getWorkspacesDir(): string {
    return join(this.getDataDir(), 'workspaces');
  }

  getClientDir(): string {
    return join(this.getDataDir(), 'client');
  }

  getBinDir(): string {
    return join(this.getDataDir(), 'bin');
  }

  getBinaryPath(): string {
    const binaryName = process.platform === 'win32' ? 'prokopai.exe' : 'prokopai';
    return join(this.getBinDir(), binaryName);
  }
}

/**
 * Singleton instance. Use Paths.configure() / Paths.reset() to override.
 */
export const Paths = new PathsSingleton();

// ── Convenience exports (free functions backed by singleton) ─────
// These keep all existing consumers working without any changes.

export function getDataDir(): string { return Paths.getDataDir(); }
export function getConfigPath(): string { return Paths.getConfigPath(); }
export function getModelsConfigPath(): string { return Paths.getModelsConfigPath(); }
export function getEnvFilePath(): string { return Paths.getEnvFilePath(); }
export function getAuthTokenPath(): string { return Paths.getAuthTokenPath(); }
export function getWebPushCredentialsPath(): string { return Paths.getWebPushCredentialsPath(); }
export function getMcpAuthPath(): string { return Paths.getMcpAuthPath(); }
export function getGlobalAgentsPath(): string { return Paths.getGlobalAgentsPath(); }
export function getPidFilePath(): string { return Paths.getPidFilePath(); }
export function getLogFilePath(): string { return Paths.getLogFilePath(); }
export function getDatabaseDir(): string { return Paths.getDatabaseDir(); }
export function getDefaultDatabasePath(): string { return Paths.getDefaultDatabasePath(); }
export function getUploadDir(): string { return Paths.getUploadDir(); }
export function getAttachmentDir(workspaceId: string, sessionId: string): string { return Paths.getAttachmentDir(workspaceId, sessionId); }
export function getToolsDir(): string { return Paths.getToolsDir(); }
export function getPreconfigsDir(): string { return Paths.getPreconfigsDir(); }
export function getPromptsDir(): string { return Paths.getPromptsDir(); }
export function getProvidersDir(): string { return Paths.getProvidersDir(); }
export function getProviderPath(provider: string): string { return Paths.getProviderPath(provider); }
export function getWorkspacesDir(): string { return Paths.getWorkspacesDir(); }
export function getClientDir(): string { return Paths.getClientDir(); }
export function getBinDir(): string { return Paths.getBinDir(); }
export function getBinaryPath(): string { return Paths.getBinaryPath(); }
