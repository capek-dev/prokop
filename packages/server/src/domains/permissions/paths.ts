import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { resolve as resolvePath } from 'node:path';
import { SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';

// Credentials is a common source-code name, not evidence of secret material.
export const SENSITIVE_PATH_PATTERNS = [
  ...SENSITIVE_FILE_PATTERNS.filter(pattern => pattern !== 'credentials'),
  '.git-credentials',
  '.aws/credentials',
];

/** True when a path references sensitive material (.env, .key, .pem, ...). */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some(pattern => path.toLowerCase().includes(pattern));
}

/** True when path equals or sits inside root. */
export function isWithinRoot(path: string, root: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

/** True when path escapes root (the inverse of isWithinRoot for non-equal paths). */
export function isOutsideRoot(path: string, root: string): boolean {
  const offset = relative(root, path);
  return offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset);
}

/** Follows existing symlink ancestors so an existing symlink cannot turn a
 * low-risk read/write into an outside-root operation; missing tail segments
 * keep their literal spelling. */
export function effectivePath(path: string): string {
  return resolveEffectivePath(path, 0);
}

function resolveEffectivePath(path: string, depth: number): string {
  if (depth > 40) throw new Error('Cannot resolve permission path: too many symlinks');
  let ancestor = path;
  while (true) {
    try {
      return resolvePath(realpathSync(ancestor), relative(ancestor, path));
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ELOOP') throw error;
      // realpath fails for dangling links. Resolve the link itself before
      // walking upward, otherwise a missing outside target looks contained.
      let link: string | undefined;
      try {
        if (lstatSync(ancestor).isSymbolicLink()) link = readlinkSync(ancestor);
      } catch (statError: unknown) {
        const statCode = (statError as NodeJS.ErrnoException).code;
        if (statCode !== 'ENOENT' && statCode !== 'ENOTDIR') throw statError;
      }
      if (link !== undefined) {
        return resolveEffectivePath(resolvePath(dirname(ancestor), link, relative(ancestor, path)), depth + 1);
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) return path;
      ancestor = parent;
    }
  }
}
