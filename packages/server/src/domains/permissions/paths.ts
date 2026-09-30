import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { resolve as resolvePath } from 'node:path';
import { SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';

/** True when a path references sensitive material (.env, .key, .pem, ...). */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some(pattern => path.toLowerCase().includes(pattern));
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
  let ancestor = path;
  while (true) {
    try {
      return resolvePath(realpathSync(ancestor), relative(ancestor, path));
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return path;
      ancestor = parent;
    }
  }
}
