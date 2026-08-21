import { join } from 'path';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  watchFile,
  writeFileSync,
} from 'fs';
import { getPidFilePath as getPidFilePathFromPaths, getLogFilePath as getLogFilePathFromPaths, getDataDir } from '@/infrastructure/runtime/paths';

import { getPort, getHost } from '@/config';
import { getToolEnv, getTlsEnabled, getTlsCertFile, getTlsKeyFile, getClientEnabled, getClientPort } from '@/infrastructure/runtime/environment';

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  host?: string;
  startedAt?: string;
}

export interface DaemonOptions {
  port?: number;
  host?: string;
}

export interface DaemonResult {
  success: boolean;
  pid?: number;
  error?: string;
}

interface PidFileData {
  pid: number;
  port: number;
  host: string;
  startedAt: string;
}

function getConfigDir(): string {
  return getDataDir();
}

export function getPidFilePath(): string {
  return getPidFilePathFromPaths();
}

export function getLogFilePath(): string {
  return getLogFilePathFromPaths();
}

function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
}

function readPidFile(): PidFileData | null {
  const pidFilePath = getPidFilePath();
  if (!existsSync(pidFilePath)) {
    return null;
  }

  try {
    const content = readFileSync(pidFilePath, 'utf-8');
    return JSON.parse(content) as PidFileData;
  } catch {
    return null;
  }
}

function writePidFile(data: { pid: number; port: number; host: string }): void {
  const pidFilePath = getPidFilePath();
  const dataWithTimestamp: PidFileData = {
    ...data,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(pidFilePath, JSON.stringify(dataWithTimestamp, null, 2));
}

function removePidFile(): void {
  const pidFilePath = getPidFilePath();
  if (existsSync(pidFilePath)) {
    unlinkSync(pidFilePath);
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startDaemon(options?: DaemonOptions): Promise<DaemonResult> {
  const status = getStatus();

  if (status.running) {
    return {
      success: false,
      error: `Daemon already running with PID ${status.pid}`,
    };
  }

  const port = options?.port ?? getPort();
  const host = options?.host ?? getHost();

  // Child env passes both canonical PROKOPAI_* keys and legacy JEAN2_* twins
  // so the spawned server (possibly a different version during update)
  // resolves them under either prefix.
  const childEnv = (): NodeJS.ProcessEnv => ({
    ...getToolEnv(),
    PROKOPAI_PORT: String(port),
    PROKOPAI_HOST: host,
    JEAN2_PORT: String(port),
    JEAN2_HOST: host,
    ...(getTlsEnabled() && {
      PROKOPAI_TLS_ENABLED: 'true',
      JEAN2_TLS_ENABLED: 'true',
      ...(getTlsCertFile() && { PROKOPAI_TLS_CERT_FILE: getTlsCertFile(), JEAN2_TLS_CERT_FILE: getTlsCertFile() }),
      ...(getTlsKeyFile() && { PROKOPAI_TLS_KEY_FILE: getTlsKeyFile(), JEAN2_TLS_KEY_FILE: getTlsKeyFile() }),
    }),
  });

  ensureConfigDir();

  const logFilePath = getLogFilePath();
  const logFd = openSync(logFilePath, 'a');

  const isCompiled = !process.argv[1]?.endsWith('.ts');

  let child: ReturnType<typeof Bun.spawn<"ignore", number, number>>;

  if (isCompiled) {
    const binaryPath = process.execPath;
    child = Bun.spawn(
      [binaryPath, 'server', '--port', String(port), '--host', host],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: childEnv(),
      }
    );
  } else {
    const scriptPath = process.argv[1] || join(process.cwd(), 'packages/server/src/index.ts');
    child = Bun.spawn(
      ['bun', 'run', scriptPath, 'server', '--port', String(port), '--host', host],
      {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: childEnv(),
      }
    );
  }

  const pid = child.pid;
  closeSync(logFd);

  if (!pid) {
    return {
      success: false,
      error: 'Failed to spawn daemon process',
    };
  }

  writePidFile({ pid, port, host });

  child.unref();

  const tls = getTlsEnabled() ? { cert: getTlsCertFile(), key: getTlsKeyFile() } : undefined;
  const protocol = tls ? 'https' : 'http';

  console.log(`Daemon started with PID ${pid}`);
  console.log(`Server running at ${protocol}://${host}:${port}`);
  if (getClientEnabled()) {
    console.log(`Client running at http://localhost:${getClientPort()}`);
  }
  console.log(`Logs: ${logFilePath}`);

  return { success: true, pid };
}

export async function stopDaemon(): Promise<DaemonResult> {
  const pidData = readPidFile();

  if (!pidData) {
    return {
      success: false,
      error: 'Daemon not running',
    };
  }

  const { pid } = pidData;

  if (!isProcessAlive(pid)) {
    removePidFile();
    return {
      success: false,
      error: 'Daemon process not found (stale PID file)',
    };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    removePidFile();
    return {
      success: false,
      error: `Failed to send SIGTERM: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const maxWaitMs = 5000;
  const pollIntervalMs = 100;
  let waitedMs = 0;

  while (waitedMs < maxWaitMs) {
    if (!isProcessAlive(pid)) {
      removePidFile();
      console.log(`Daemon stopped (PID ${pid})`);
      return { success: true, pid };
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    waitedMs += pollIntervalMs;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (err) {
    removePidFile();
    return {
      success: false,
      error: `Failed to send SIGKILL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!isProcessAlive(pid)) {
    removePidFile();
    console.log(`Daemon forcefully stopped (PID ${pid})`);
    return { success: true, pid };
  }

  removePidFile();
  return {
    success: false,
    error: 'Failed to stop daemon even with SIGKILL',
  };
}

export async function restartDaemon(options?: DaemonOptions): Promise<DaemonResult> {
  const stopResult = await stopDaemon();

  if (!stopResult.success && stopResult.error !== 'Daemon not running') {
    return stopResult;
  }

  await new Promise(resolve => setTimeout(resolve, 1000));

  return startDaemon(options);
}

export function getStatus(): DaemonStatus {
  const pidData = readPidFile();

  if (!pidData) {
    return { running: false };
  }

  const { pid, port, host, startedAt } = pidData;

  if (!isProcessAlive(pid)) {
    removePidFile();
    return { running: false };
  }

  return {
    running: true,
    pid,
    port,
    host,
    startedAt,
  };
}

const INITIAL_LOG_LINES = 10;
const LOG_READ_BUFFER_SIZE = 64 * 1024;

function readLogRange(logFilePath: string, start: number, end: number): void {
  if (end <= start) {
    return;
  }

  const fd = openSync(logFilePath, 'r');

  try {
    let position = start;
    while (position < end) {
      const buffer = Buffer.allocUnsafe(Math.min(LOG_READ_BUFFER_SIZE, end - position));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      process.stdout.write(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
}

function printInitialLogLines(logFilePath: string, fileSize: number): void {
  if (fileSize === 0) {
    return;
  }

  const start = Math.max(0, fileSize - LOG_READ_BUFFER_SIZE);
  const fd = openSync(logFilePath, 'r');

  try {
    const buffer = Buffer.allocUnsafe(fileSize - start);
    const bytesRead = readSync(fd, buffer, 0, buffer.length, start);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    const lines = content.split('\n');
    const trailingNewline = content.endsWith('\n');
    const completeLines = trailingNewline ? lines.slice(0, -1) : lines;
    const output = completeLines.slice(-INITIAL_LOG_LINES).join('\n');

    if (output) {
      process.stdout.write(output);
      if (trailingNewline) {
        process.stdout.write('\n');
      }
    }
  } finally {
    closeSync(fd);
  }
}

export function tailLogs(): void {
  const logFilePath = getLogFilePath();

  if (!existsSync(logFilePath)) {
    console.log(`Log file does not exist: ${logFilePath}`);
    console.log('The daemon must be started first to create the log file.');
    return;
  }

  let offset = statSync(logFilePath).size;
  printInitialLogLines(logFilePath, offset);

  watchFile(logFilePath, { interval: 250 }, (current, previous) => {
    if (current.size < offset || current.ino !== previous.ino) {
      offset = 0;
    }

    if (current.size > offset) {
      try {
        readLogRange(logFilePath, offset, current.size);
        offset = current.size;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read log file: ${message}`);
      }
    }
  });
}
