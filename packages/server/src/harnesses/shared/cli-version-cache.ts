import { realpathSync, statSync } from 'node:fs';

type ProbeResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Identity of the executable `command` resolves to on PATH: real path plus
 * inode, size, and mtime. Null when the command is not on PATH.
 */
export function executableIdentity(command: string): string | null {
  const found = Bun.which(command);
  if (!found) return null;
  try {
    const path = realpathSync(found);
    const stats = statSync(path);
    return `${path}\0${stats.ino}\0${stats.size}\0${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

/**
 * Memoizes a synchronous CLI version probe per executable identity.
 *
 * The probes run `Bun.spawnSync`, which blocks the event loop for the whole
 * CLI startup, and they are called by status routes, catalog reads, session
 * creation, and every turn. Keying the result (or failure) on the resolved
 * binary keeps exact-version checks correct: an upgrade or PATH change yields
 * a new identity and the next call probes again. A command missing from PATH
 * is never cached; the probe fails without starting a process.
 */
export function memoizeCliProbe<T>(
  command: string,
  probe: () => T,
  identify: (command: string) => string | null = executableIdentity,
): () => T {
  let cached: { identity: string; result: ProbeResult<T> } | null = null;
  return () => {
    const identity = identify(command);
    if (identity === null) return probe();
    if (cached?.identity !== identity) {
      let result: ProbeResult<T>;
      try {
        result = { ok: true, value: probe() };
      } catch (error) {
        result = { ok: false, error };
      }
      cached = { identity, result };
    }
    if (!cached.result.ok) throw cached.result.error;
    return cached.result.value;
  };
}
