import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { existsSync, statSync, openSync, renameSync } from 'fs';

import { VERSION } from '@/version';
import { getStatus, stopDaemon, getLogFilePath } from '@/infrastructure/daemon';
import { getToolEnv } from '@/infrastructure/runtime/environment';
import { isInitialized } from '@/config';

export interface UpdateOptions {
  version?: string;
  force?: boolean;
  dryRun?: boolean;
  noRestart?: boolean;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export interface UpdateResult {
  success: boolean;
  error?: string;
  previousVersion?: string;
  newVersion?: string;
}

const VERSION_FILE_URL = 'https://raw.githubusercontent.com/capek-dev/prokop/refs/heads/main/packages/server/VERSION';
const REPO = 'capek-dev/prokop';

export function detectPlatform(): 'darwin' | 'linux' | 'windows' {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/** Whether the given release version still used legacy jean2-* asset names. */
export function usesLegacyAssetName(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major < 1 || (major === 1 && minor <= 4);
}

export function getDownloadUrl(version: string, platform: string): string {
  const assetName = usesLegacyAssetName(version)
    ? (platform === 'windows' ? 'jean2-windows.exe' : `jean2-${platform}`)
    : (platform === 'windows' ? 'prokop-windows.exe' : `prokop-${platform}`);
  return `https://github.com/${REPO}/releases/download/server%2Fv${version}/${assetName}`;
}

export function getUpdateBinaryPath(
  executablePath: string,
  platform: 'darwin' | 'linux' | 'windows',
): string {
  const binaryName = platform === 'windows' ? 'prokop.exe' : 'prokop';
  return join(dirname(executablePath), binaryName);
}

export function isCompiledBinary(): boolean {
  return !process.argv[1]?.endsWith('.ts');
}

export async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(VERSION_FILE_URL, {
    headers: {
      'User-Agent': 'prokop-updater',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest version: ${response.status} ${response.statusText}`);
  }

  const version = (await response.text()).trim();

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format from remote: ${version}`);
  }

  return version;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  console.log('info: Fetching latest version...');

  const latestVersion = await fetchLatestVersion();
  const currentVersion = VERSION;

  console.log(`info: Current version: ${currentVersion}`);
  console.log(`info: Latest version: ${latestVersion}`);

  const updateAvailable = currentVersion !== latestVersion;

  if (updateAvailable) {
    console.log('info: Update available!');
  } else {
    console.log('info: Already up to date');
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
  };
}

export async function downloadBinary(url: string, destPath: string): Promise<void> {
  console.log(`info: Downloading prokop for ${detectPlatform()}...`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'prokop-updater',
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await Bun.write(destPath, buffer);

  console.log('info: Download complete');
}

function spawnPostUpdateTasks(
  binaryPath: string,
  oldPath: string,
  options: { needsMigration: boolean; wasDaemonRunning: boolean },
): void {
  const logFd = openSync(getLogFilePath(), 'a');
  const platform = detectPlatform();

  if (platform === 'windows') {
    const actions: string[] = [];

    actions.push(`ping -n 4 127.0.0.1 >nul`);
    actions.push(`del /f /q "${oldPath}" 2>nul`);

    if (options.needsMigration) {
      actions.push(`"${binaryPath}" migrate`);
    }
    if (options.wasDaemonRunning) {
      actions.push(`"${binaryPath}" start`);
    }

    const command = actions.join(' && ');

    const child = Bun.spawn(
      ['cmd.exe', '/c', command],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: {
          ...getToolEnv(),
        },
        windowsHide: true,
      },
    );
    child.unref();
  } else {
    const actions: string[] = [];

    actions.push(`sleep 2`);
    actions.push(`rm -f '${oldPath}'`);

    if (options.needsMigration) {
      actions.push(`'${binaryPath}' migrate`);
    }
    if (options.wasDaemonRunning) {
      actions.push(`'${binaryPath}' start`);
    }

    const command = actions.join(' && ');

    const child = Bun.spawn(['sh', '-c', command], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...getToolEnv(),
      },
    });
    child.unref();
  }
}

export async function performUpdate(options: UpdateOptions): Promise<UpdateResult> {
  if (!isCompiledBinary()) {
    return {
      success: false,
      error: 'Self-update is only available when running the compiled binary',
    };
  }

  const currentVersion = VERSION;
  const targetVersion = options.version || (await fetchLatestVersion());

  if (targetVersion === currentVersion && !options.force) {
    if (options.dryRun) {
      console.log('info: Already up to date');
    }
    return {
      success: true,
      previousVersion: currentVersion,
      newVersion: currentVersion,
    };
  }

  if (options.dryRun) {
    console.log(`info: Update available: v${currentVersion} → v${targetVersion}`);
    return {
      success: true,
      previousVersion: currentVersion,
      newVersion: targetVersion,
    };
  }

  const platform = detectPlatform();
  const downloadUrl = getDownloadUrl(targetVersion, platform);

  let wasDaemonRunning = false;
  if (!options.noRestart) {
    const status = getStatus();
    if (status.running) {
      console.log('info: Stopping daemon...');
      await stopDaemon();
      wasDaemonRunning = true;
    }
  }

  const needsMigration = isInitialized();

  const tempDir = tmpdir();
  const tempPath = join(tempDir, `prokop-update-${Date.now()}`);

  await downloadBinary(downloadUrl, tempPath);

  if (!existsSync(tempPath)) {
    return {
      success: false,
      error: 'Download verification failed: file not found',
    };
  }

  const fileStats = statSync(tempPath);
  if (fileStats.size === 0) {
    return {
      success: false,
      error: 'Download verification failed: file is empty',
    };
  }

  if (options.noRestart) {
    console.log('info: Installing update... (--no-restart: daemon will not be restarted)');
  } else {
    console.log('info: Installing update... (daemon will restart automatically)');
  }

  const binaryPath = process.execPath;
  const targetPath = getUpdateBinaryPath(binaryPath, platform);

  if (platform === 'windows') {
    // Windows: rename the running binary (allowed even while running),
    // then move the new one into place without waiting for exit.
    const oldPath = binaryPath + '.old';

    try {
      // Clean up any leftover .old from a previous update
      try { renameSync(oldPath, oldPath + '.tmp'); } catch { /* ignore */ }

      // Step 1: rename running exe to .old (Windows allows this)
      renameSync(binaryPath, oldPath);

      // Step 2: install the new binary under the canonical command name.
      renameSync(tempPath, targetPath);

      // Step 3: spawn background process for cleanup + restart
      spawnPostUpdateTasks(targetPath, oldPath, {
        needsMigration,
        wasDaemonRunning,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Failed to replace binary: ${message}`,
      };
    }
  } else {
    // Unix: spawn background replacer that waits for exit then moves.
    const oldPath = binaryPath + '.old';
    const cleanupPaths = targetPath === binaryPath
      ? `'${oldPath}'`
      : `'${binaryPath}' '${oldPath}'`;
    let command = `sleep 1 && mv -f '${tempPath}' '${targetPath}' && chmod +x '${targetPath}' && rm -f ${cleanupPaths}`;

    if (needsMigration || wasDaemonRunning) {
      const actions: string[] = [];
      if (needsMigration) {
        actions.push(`'${targetPath}' migrate`);
      }
      if (wasDaemonRunning) {
        actions.push(`'${targetPath}' start`);
      }
      command += ` && ${actions.join(' && ')}`;
    }

    const logFd = openSync(getLogFilePath(), 'a');
    const child = Bun.spawn(['sh', '-c', command], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...getToolEnv(),
      },
    });
    child.unref();
  }

  return {
    success: true,
    previousVersion: currentVersion,
    newVersion: targetVersion,
  };
}
