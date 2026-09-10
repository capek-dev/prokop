import { SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';

/** Home knowledge access excludes private runtime/configuration trees. */
export function isLearningHomePath(path: string): boolean {
  if (!path || path.includes('\\') || [...path].some(character => character.charCodeAt(0) < 32 || character === ':') || path.length > 1024) return false;
  const parts = path.split('/');
  if (parts.length > 20 || parts.some(part => !part || part.startsWith('.'))) return false;
  const lower = path.toLowerCase();
  return !SENSITIVE_FILE_PATTERNS.some(pattern => lower.includes(pattern))
    && !parts.some(part => /^(node_modules|credentials|secrets|config|configuration)$/i.test(part))
    && !/\.(pem|key|p12|pfx|sqlite|db)$/i.test(path);
}
