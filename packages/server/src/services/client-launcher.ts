import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { getClientDir } from '@/infrastructure/runtime/paths';
import {
  createArborist,
  fetchPackageMetadata,
  extractIntegrity,
} from '@/services/npm-utils';
import { createStaticRequestHandler } from '@/services/client-static-server';

const CLIENT_PACKAGE = '@jean2/client';
const MANIFEST_FILE = '.client-manifest.json';

interface ClientManifest {
  version: string;
  installedAt: string;
  lastUpdateCheck?: string;
  integrity?: string;
}

function getClientManifestPath(clientDir = getClientDir()): string {
  return join(clientDir, MANIFEST_FILE);
}

function readClientManifest(): ClientManifest | null {
  const path = getClientManifestPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function writeClientManifest(manifest: ClientManifest, clientDir = getClientDir()): void {
  writeFileSync(getClientManifestPath(clientDir), JSON.stringify(manifest, null, 2));
}

async function installClientPackage(
  clientDir = getClientDir(),
): Promise<{ version: string; integrity: string | null }> {
  mkdirSync(clientDir, { recursive: true });

  const pkgJsonPath = join(clientDir, 'package.json');
  const pkgJson = {
    name: 'jean2-client-install',
    version: '1.0.0',
    private: true,
    dependencies: {
      [CLIENT_PACKAGE]: 'latest',
    },
  };

  writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2));

  const arb = createArborist(clientDir);

  console.log('[client] Installing @jean2/client from npm...');
  const tree = await arb.reify();

  const child = tree?.children?.get(CLIENT_PACKAGE);
  if (!child) {
    throw new Error('Failed to install @jean2/client: package not found in tree');
  }

  const version = (child as unknown as { package?: { version?: string } }).package?.version || 'unknown';
  const integrity = extractIntegrity(tree, CLIENT_PACKAGE);
  writeClientManifest({
    version,
    installedAt: new Date().toISOString(),
    lastUpdateCheck: new Date().toISOString(),
    integrity: integrity ?? undefined,
  }, clientDir);

  console.log(`[client] Installed @jean2/client@${version}${integrity ? ` (verified)` : ''}`);
  return { version, integrity };
}

function getCliPath(clientDir = getClientDir()): string | null {
  const cliPath = join(clientDir, 'node_modules', CLIENT_PACKAGE, 'dist', 'cli.mjs');
  return existsSync(cliPath) ? cliPath : null;
}

async function installClientUpdate(): Promise<string> {
  const clientDir = getClientDir();
  const stagingDir = `${clientDir}.update-${process.pid}`;
  const backupDir = `${clientDir}.backup-${process.pid}`;

  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });

  try {
    const result = await installClientPackage(stagingDir);
    if (!getCliPath(stagingDir)) {
      throw new Error('Updated @jean2/client package does not contain a usable CLI');
    }

    renameSync(clientDir, backupDir);
    try {
      renameSync(stagingDir, clientDir);
    } catch (err: unknown) {
      renameSync(backupDir, clientDir);
      throw err;
    }

    rmSync(backupDir, { recursive: true, force: true });
    return result.version;
  } catch (err: unknown) {
    rmSync(stagingDir, { recursive: true, force: true });
    if (!existsSync(clientDir) && existsSync(backupDir)) {
      renameSync(backupDir, clientDir);
    }
    throw err;
  }
}

function isInstalled(): boolean {
  return getCliPath() !== null;
}

async function fetchLatestVersion(): Promise<string | null> {
  const metadata = await fetchPackageMetadata(CLIENT_PACKAGE);
  if (!metadata) return null;

  return metadata.distTags.latest ?? null;
}

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(latest);
  const b = parse(current);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

export async function runClientCommand(cliPath: string, port: number): Promise<void> {
  const distPath = join(cliPath, '..');

  process.argv = [process.argv[0], cliPath, '--port', String(port)];

  const http = await import('node:http');
  const https = await import('node:https');
  const fs = await import('node:fs');

  const tlsEnabled = process.env.JEAN2_TLS_ENABLED === 'true';
  let tlsOptions: { cert: string; key: string } | undefined;

  if (tlsEnabled) {
    const certPath = process.env.JEAN2_TLS_CERT_FILE;
    const keyPath = process.env.JEAN2_TLS_KEY_FILE;
    if (certPath && keyPath) {
      try {
        tlsOptions = {
          cert: fs.readFileSync(certPath, 'utf-8'),
          key: fs.readFileSync(keyPath, 'utf-8'),
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[client] Failed to read TLS certificate/key: ${message}`);
        process.exit(1);
      }
    } else {
      console.error('[client] JEAN2_TLS_ENABLED is set but JEAN2_TLS_CERT_FILE and/or JEAN2_TLS_KEY_FILE are missing');
      process.exit(1);
    }
  }

  const requestHandler = createStaticRequestHandler(distPath);

  const server = tlsOptions
    ? https.createServer(tlsOptions, requestHandler)
    : http.createServer(requestHandler);

  server.on('error', (err) => {
    console.error(`[client] Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, () => {
    const protocol = tlsOptions ? 'https' : 'http';
    console.log(`Jean2 client running at ${protocol}://localhost:${port}`);
  });

  function shutdown() {
    server.close(() => {
      process.exit(0);
    });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export interface LaunchResult {
  success: boolean;
  pid?: number;
  port: number;
  url: string;
  error?: string;
}

export interface ClientLauncher {
  ensureInstalled(): Promise<string | null>;
  checkForUpdate(): Promise<string | null>;
  installUpdate(): Promise<string>;
  launch(port: number, serverPort: number, serverHost: string): Promise<LaunchResult>;
  stop(): void;
  isRunning(): boolean;
  getInstalledVersion(): string | null;
}

export interface PreparedClientResult {
  version: string | null;
  launchResult: LaunchResult | null;
}

export async function prepareAndLaunchClient(
  launcher: ClientLauncher,
  clientPort: number,
  serverPort: number,
  serverHost: string,
): Promise<PreparedClientResult> {
  let version = await launcher.ensureInstalled();
  if (!version) return { version: null, launchResult: null };

  try {
    const latestVersion = await launcher.checkForUpdate();
    if (latestVersion) {
      console.log(`[client] Updating from ${version} to ${latestVersion}...`);
      try {
        version = await launcher.installUpdate();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[client] Update failed, launching installed version: ${message}`);
        version = launcher.getInstalledVersion() ?? version;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[client] Update check failed, launching installed version: ${message}`);
  }

  const launchResult = await launcher.launch(clientPort, serverPort, serverHost);
  return {
    version: launcher.getInstalledVersion() ?? version,
    launchResult,
  };
}

export function createClientLauncher(): ClientLauncher {
  let childProcess: ReturnType<typeof Bun.spawn> | null = null;

  return {
    async ensureInstalled(): Promise<string | null> {
      if (isInstalled()) {
        const manifest = readClientManifest();
        return manifest?.version ?? null;
      }

      try {
        const result = await installClientPackage();
        return result.version;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[client] Failed to install: ${message}`);
        return null;
      }
    },

    async checkForUpdate(): Promise<string | null> {
      const manifest = readClientManifest();
      if (!manifest) return null;

      const latestVersion = await fetchLatestVersion();
      if (!latestVersion) return null;

      // Update the last check timestamp regardless
      writeClientManifest({
        ...manifest,
        lastUpdateCheck: new Date().toISOString(),
      });

      if (isNewerVersion(latestVersion, manifest.version)) {
        console.log(`[client] Update available: ${manifest.version} → ${latestVersion}`);
        return latestVersion;
      }

      return null;
    },

    async installUpdate(): Promise<string> {
      console.log('[client] Installing update...');
      return installClientUpdate();
    },

    async launch(port: number, serverPort: number, serverHost: string): Promise<LaunchResult> {
      const cliPath = getCliPath();
      if (!cliPath) {
        return {
          success: false,
          port,
          url: '',
          error: '@jean2/client CLI not found. Run ensureInstalled() first.',
        };
      }

      const clientProtocol = process.env.JEAN2_TLS_ENABLED === 'true' ? 'https' : 'http';
      const url = `${clientProtocol}://localhost:${port}`;

      try {
        childProcess = Bun.spawn(
          [
            process.execPath,
            '_client',
            '--cli-path', cliPath,
            '--port', String(port),
          ],
          {
            detached: false,
            windowsHide: true,
            stdout: 'inherit',
            stderr: 'inherit',
            env: {
              ...process.env,
              JEAN2_SERVER_URL: `${clientProtocol}://${serverHost === '0.0.0.0' ? 'localhost' : serverHost}:${serverPort}`,
            },
          },
        );

        // Give it a moment to detect immediate crashes (e.g. bad CLI args)
        await new Promise((resolve) => setTimeout(resolve, 500));

        if (childProcess.exitCode !== null) {
          const code = childProcess.exitCode;
          childProcess = null;
          return {
            success: false,
            port,
            url,
            error: `Client process exited immediately with code ${code}`,
          };
        }

        childProcess.exited.then((code) => {
          if (code !== 0 && childProcess !== null) {
            console.warn(`[client] Process exited with code ${code}`);
            childProcess = null;
          }
        }).catch(() => {});

        console.log(`[client] Launched @ PID ${childProcess.pid} → ${url}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          port,
          url,
          error: `Failed to launch client: ${message}`,
        };
      }

      return {
        success: true,
        pid: childProcess.pid,
        port,
        url,
      };
    },

    stop(): void {
      if (childProcess && childProcess.exitCode === null) {
        try {
          childProcess.kill();
          console.log('[client] Stopped');
        } catch {
          // Process may have already exited
        }
        childProcess = null;
      }
    },

    isRunning(): boolean {
      return childProcess !== null && childProcess.exitCode === null;
    },

    getInstalledVersion(): string | null {
      return readClientManifest()?.version ?? null;
    },
  };
}
