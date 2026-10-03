/**
 * Detection data and pure matchers for the permissions v2 classifier.
 *
 * Data plus flag matching only; command orchestration (segment splitting, cwd
 * tracking, operand resolution) lives in analyze.ts.
 */

// ---------------------------------------------------------------------------
// Destructive rules
// ---------------------------------------------------------------------------

export type DestructiveRule =
  | {
      /** Destructive when a listed long flag or short flag char is present. */
      kind: 'flags';
      base: string;
      sub?: string;
      long: readonly string[];
      chars: readonly string[];
    }
  | { /** Destructive on any invocation. */ kind: 'always'; base: string; sub?: string }
  | {
      /** Needs operand analysis in analyze.ts (e.g. `git checkout .`). */
      kind: 'selector';
      base: string;
      sub?: string;
    };

export const DESTRUCTIVE_RULES: readonly DestructiveRule[] = [
  { kind: 'flags', base: 'rm', long: ['--recursive', '--force'], chars: ['r', 'f'] },
  { kind: 'flags', base: 'git', sub: 'reset', long: ['--hard'], chars: [] },
  { kind: 'flags', base: 'git', sub: 'clean', long: ['--force'], chars: ['f'] },
  { kind: 'flags', base: 'git', sub: 'push', long: ['--force'], chars: ['f'] },
  { kind: 'selector', base: 'git', sub: 'checkout' },
  { kind: 'selector', base: 'git', sub: 'restore' },
  { kind: 'always', base: 'dd' },
  { kind: 'always', base: 'shred' },
  { kind: 'always', base: 'sudo' },
  { kind: 'always', base: 'su' },
  { kind: 'always', base: 'doas' },
  { kind: 'flags', base: 'chmod', long: ['--recursive'], chars: ['r'] },
  { kind: 'flags', base: 'chown', long: ['--recursive'], chars: ['r'] },
];

/** The shape analyze.ts extracts from one command segment. */
export interface InvocationShape {
  base: string;
  /** First non-flag argument for multiplexers like git. */
  sub?: string;
  args: readonly string[];
}

export interface DestructiveMatch {
  rule: DestructiveRule;
  reason: string;
}

function shortFlagChars(args: readonly string[]): Set<string> {
  const chars = new Set<string>();
  for (const arg of args) {
    if (arg.length < 2 || arg.startsWith('--') || !arg.startsWith('-')) continue;
    for (const ch of arg.slice(1)) chars.add(ch.toLowerCase());
  }
  return chars;
}

/** Matches an invocation against the destructive table. Selector rules match
 * so analyze.ts can apply their operand logic; the reason says so. */
export function matchDestructiveRule(invocation: InvocationShape): DestructiveMatch | null {
  const base = invocation.base.toLowerCase();
  const sub = invocation.sub?.toLowerCase();
  for (const rule of DESTRUCTIVE_RULES) {
    if (rule.base !== base) continue;
    if ((rule.sub ?? undefined) !== (sub ?? undefined)) continue;

    if (rule.kind === 'always') {
      return { rule, reason: `${base} always destructive` };
    }
    if (rule.kind === 'selector') {
      return { rule, reason: `${base}${sub ? ' ' + sub : ''} needs operand analysis` };
    }
    if (invocation.args.some(arg => rule.long.includes(arg.toLowerCase()))) {
      return { rule, reason: `${base}${sub ? ' ' + sub : ''} with a destructive flag` };
    }
    const chars = shortFlagChars(invocation.args);
    if (rule.chars.some(ch => chars.has(ch))) {
      return { rule, reason: `${base}${sub ? ' ' + sub : ''} with a destructive flag` };
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Catastrophic rules
// ---------------------------------------------------------------------------

/** Base commands that are catastrophic on any invocation (prefix matched). */
export const CATASTROPHIC_BASES: readonly string[] = [
  'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff',
];

/** Directory roots whose deletion or overwrite is catastrophic regardless of
 * the invoking command's flags. */
export const PROTECTED_TARGET_ROOTS: readonly string[] = [
  '/etc', '/usr', '/bin', '/sbin', '/var', '/lib', '/lib64', '/boot',
  '/opt', '/System', '/Library', '/private', '/Applications',
];

/** User-tree roots protected only as exact targets: real workspaces live
 * beneath them, so prefix matching would make every workspace deletion
 * catastrophic. The user's home is likewise protected only as an exact target
 * (`rm -rf ~` is catastrophic; `rm -rf ~/project` is merely destructive). */
export const PROTECTED_EXACT_TARGET_ROOTS: readonly string[] = ['/home', '/Users'];

/** True when a resolved target sits at or inside a protected root. `home` is
 * the current user's home directory (protected as an exact target). The `/`
 * entry protects only the root itself; everything absolute lives under it. */
export function isProtectedTarget(path: string, home: string): boolean {
  if (!path) return false;
  if (path === '/') return true;
  if (PROTECTED_EXACT_TARGET_ROOTS.includes(path)) return true;
  if (home && path === home) return true;
  return PROTECTED_TARGET_ROOTS.some(root => path === root || path.startsWith(root + '/'));
}

// ---------------------------------------------------------------------------
// Raw-text token screen
// ---------------------------------------------------------------------------

/**
 * Tokens whose appearance (as shell words, after analyze.ts strips quoted
 * strings) escalates a command out of the clean/opaque fast path into full
 * segment analysis. Presence never decides anything by itself.
 */
export const SCREENED_TOKENS: readonly string[] = [
  'rm', 'dd', 'shred', 'sudo', 'su', 'doas', 'chmod', 'chown',
  'git', 'mkfs', 'shutdown', 'reboot', 'halt', 'poweroff',
  'eval', 'exec', 'xargs',
];

const SCREENED_BOUNDARY_END = '(?=$|[\\s;|&/)])';

/** True when text contains any screened token as a standalone shell word. */
export function containsScreenedToken(text: string): boolean {
  return SCREENED_TOKENS.some(token => {
    const pattern = new RegExp(`(?:^|[\\s;|&(/])${token}${SCREENED_BOUNDARY_END}`, 'i');
    return pattern.test(text);
  });
}

// ---------------------------------------------------------------------------
// Sensitive file matching
// ---------------------------------------------------------------------------

const SENSITIVE_BASENAMES_EXACT = new Set([
  '.env', '.netrc', '.git-credentials', '.npmrc', '.htpasswd',
  'secrets.json',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
]);

const SENSITIVE_BASENAMES_PREFIX = ['.env.'];

const SENSITIVE_BASENAMES_SUFFIX = ['.pem', '.key', '.p12', '.pfx', '.jks'];

/** Committed templates that match the .env prefix without holding secrets. */
const SENSITIVE_TEMPLATE_SUFFIXES = ['.example', '.sample', '.template'];

const SENSITIVE_DIR_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.docker']);

/** Basename and directory-segment sensitive matching. Replaces the legacy
 * substring list, which flagged files like `password-reset.ts`. Directory
 * segments include the final segment: `.ssh`/`.aws` are always the sensitive
 * directories themselves, whether read as a target or traversed. */
export function isSensitiveFilename(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const base = segments[segments.length - 1] ?? normalized;
  if (!base) return false;
  if (SENSITIVE_BASENAMES_EXACT.has(base)) return true;
  if (
    SENSITIVE_BASENAMES_PREFIX.some(prefix =>
      base.startsWith(prefix) && !SENSITIVE_TEMPLATE_SUFFIXES.some(suffix => base.endsWith(suffix)))
  ) return true;
  if (SENSITIVE_BASENAMES_SUFFIX.some(suffix => base.endsWith(suffix))) return true;
  return segments.some(segment => SENSITIVE_DIR_SEGMENTS.has(segment));
}
