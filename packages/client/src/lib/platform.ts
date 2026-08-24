export function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Win/i.test(navigator.platform || navigator.userAgent);
}

/**
 * Check if a path is absolute, handling both Unix (/) and Windows (C:\, C:/) formats.
 */
export function isAbsolutePath(p: string): boolean {
  if (p.startsWith('/')) return true;
  if (p.length >= 3 && /^[A-Za-z]:[/\\]/.test(p)) return true;
  return false;
}

/**
 * Extract the basename (filename) from a path, handling both / and \ separators.
 */
export function pathBasename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}
