import { closeSync, lstatSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from './paths';

const ID_FILE = 'installation-id';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable per-data-root identity, never derived from the listener, pid or client reconnect token. */
export function getOrCreateInstallationId(dataDir = getDataDir()): string {
  const path = join(dataDir, ID_FILE);
  const read = (): string => {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid installation identity file');
    const id = readFileSync(path, 'utf8').trim();
    if (!ID_PATTERN.test(id)) throw new Error('Invalid installation identity');
    return id;
  };
  try {
    return read();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Exclusive creation keeps simultaneous starts from replacing an established identity.
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return read();
    throw error;
  }
  const id = crypto.randomUUID();
  try {
    writeSync(fd, `${id}\n`);
  } finally {
    closeSync(fd);
  }
  return id;
}
