/**
 * Isolated Prokop server for screenshots.
 *
 * Never touches the production instance: own data dir, own port, foreground
 * child process, stripped PROKOPAI_/JEAN2_ env, and cwd outside the repo so
 * Bun does not auto-load the repo `.env`. Teardown kills only our child.
 *
 * The server runs with a fake HOME laid out like a real machine:
 *   <home>/.prokopai          data dir (worktrees land in .prokopai/worktrees)
 *   <home>/code/linkshelf     demo repo
 *   <home>/.prokop-screenshots  ownership marker and server logs
 * Paths in the UI show this home (default ~/prokop-demo, see prepareHome).
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Subprocess } from 'bun';
import { GIT_IDENTITY } from './seed';

export const REPO_ROOT = resolve(import.meta.dir, '../..');
const SERVER_ENTRY = join(REPO_ROOT, 'packages/server/src/index.ts');
const CLIENT_DIST = join(REPO_ROOT, 'packages/client/dist');

/** Ports the production instance uses; refused even if currently free. */
const RESERVED_PORTS = new Set([8742, 8743]);

/** Marks a home directory as created by this script, so reruns may clear it. */
const MARKER = '.prokop-screenshots';

export interface Instance {
  url: string;
  port: number;
  /** Fake HOME for the server, so tools and paths never see the real one. */
  home: string;
  dataDir: string;
  stop(): Promise<void>;
}

function isListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done(true); });
    socket.once('error', () => done(false));
  });
}

/**
 * The demo home defaults to `~/prokop-demo`, which is created when missing.
 * Not the OS temp dir: on macOS it sits under /private/var, which the
 * command classifier rightly treats as protected, so every approval would
 * read "Catastrophic", and UI paths would show the temp location.
 *
 * The directory is used when it is empty or was created by this script (its
 * contents are cleared); anything else is refused.
 */
function prepareHome(requested: string | undefined): string {
  const home = resolve(requested ?? join(homedir(), 'prokop-demo'));
  if (!requested) mkdirSync(home, { recursive: true });
  if (!existsSync(home)) throw new Error(`--home ${home} does not exist; create it first`);
  const entries = readdirSync(home);
  if (entries.length > 0 && !entries.includes(MARKER)) {
    throw new Error(`--home ${home} is not empty and was not created by this script; refusing to touch it`);
  }
  for (const entry of entries) rmSync(join(home, entry), { recursive: true, force: true });
  return realpathSync(home);
}

function isolatedEnv(dataDir: string, home: string, port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('PROKOPAI_') || key.startsWith('JEAN2_')) continue;
    env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    // zsh reads its startup files from here; keep it off the real home.
    ZDOTDIR: home,
    PROKOPAI_DATA_DIR: dataDir,
    PROKOPAI_PORT: String(port),
    PROKOPAI_HOST: '127.0.0.1',
    PROKOPAI_SANDBOX: 'true',
    // Satisfies the pre-flight key check for the default model. The sandbox
    // intercepts every call, so this placeholder never reaches the network.
    PROKOPAI_LLM_MINIMAX_API_KEY: 'sandbox-placeholder',
    // Scenes leave a permission ask open; keep it open through long --keep sessions.
    PROKOPAI_PERMISSION_TIMEOUT_MS: String(2 * 60 * 60 * 1000),
    PROKOPAI_CLIENT_ENABLED: 'true',
    PROKOPAI_CLIENT_DIR: CLIENT_DIST,
  };
}

async function waitForHealth(url: string, child: Subprocess, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Screenshot server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(200);
  }
  throw new Error(`Screenshot server did not become healthy within ${timeoutMs}ms`);
}

export async function startInstance(port: number, requestedHome?: string): Promise<Instance> {
  if (RESERVED_PORTS.has(port)) throw new Error(`Port ${port} belongs to the production instance`);
  if (await isListening(port)) throw new Error(`Port ${port} is already in use; pass --port`);

  const home = prepareHome(requestedHome);
  const marker = join(home, MARKER);
  mkdirSync(marker);
  const dataDir = join(home, '.prokopai');
  writeFileSync(join(home, '.gitconfig'), `[user]\n\tname = ${GIT_IDENTITY.GIT_AUTHOR_NAME}\n\temail = ${GIT_IDENTITY.GIT_AUTHOR_EMAIL}\n[init]\n\tdefaultBranch = main\n`);
  // Terminal prompt shows only the folder, never the real user or host name.
  writeFileSync(join(home, '.zshrc'), "PROMPT='%1~ %# '\n");
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(marker, 'server.log');
  const env = isolatedEnv(dataDir, home, port);

  const init = Bun.spawnSync(['bun', join(import.meta.dir, 'init-data.ts')], { cwd: marker, env });
  if (init.exitCode !== 0) throw new Error(`Data dir init failed: ${init.stderr.toString()}`);

  const child = Bun.spawn(['bun', SERVER_ENTRY], {
    cwd: marker,
    env,
    stdout: Bun.file(logPath),
    stderr: Bun.file(join(marker, 'server.err.log')),
  });

  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
    if (!exited) child.kill('SIGKILL');
  };

  try {
    await waitForHealth(url, child);
  } catch (error) {
    await stop();
    throw new Error(`${(error as Error).message}. Log: ${logPath}`, { cause: error });
  }

  return { url, port, home, dataDir, stop };
}
