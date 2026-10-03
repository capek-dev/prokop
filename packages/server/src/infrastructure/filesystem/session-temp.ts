import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Validate before advertising a writable root. Never repair or remove collisions. */
export function ensureSessionTempDir(sessionId: string, base = tmpdir()): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(sessionId)) {
    throw new Error('Invalid session identity for temporary files');
  }
  const root = realpathSync(base);
  for (const directory of [join(root, 'jean2'), join(root, 'jean2', sessionId)]) {
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o022) !== 0)) {
      throw new Error('Unsafe session temporary directory');
    }
  }
  return join(root, 'jean2', sessionId);
}

export function sessionTempEnvironment(directory: string): Record<string, string> {
  return { TMPDIR: directory, TEMP: directory, TMP: directory };
}

export function sessionTempInstructions(directory: string): string {
  return `Use this session's temporary directory for scratch files: ${directory}\nUse absolute paths for temporary files. Shared /tmp and other sessions' files are outside the allowed roots. Temporary paths do not exempt destructive operations from permission checks.`;
}
