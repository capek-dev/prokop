// =============================================================================
// Canonical Permission Contract
// 
// Design principles:
// 1. Tool-authored, platform-rendered: Tools define structured PermissionAsk
//    objects; client renders generically via the same UI
// 2. Shell is first-class: Explicit shell-command permission category with
//    pattern matching (command names like rm, sudo, curl)
// 3. Explicit grant semantics: Specific grant scopes (once/session/workspace)
//    with duration support. No 'always' scope — use 'workspace' instead.
// 4. ask.* is the only interactive channel: No side-channel grants
// 5. Persisted grants human-readable: Structured metadata for UI review
// =============================================================================

// =============================================================================
// Risk Level (unchanged)
// =============================================================================

export type PermissionRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

// Alias for backward compatibility
export type PermissionRisk = PermissionRiskLevel;

// =============================================================================
// Grant Scope (canonical "how long does this grant last" concept)
//
// - once: One-time use, NOT persisted to database
// - session: Until the session ends (may have duration-based expiration)
// - workspace: For all sessions in this workspace, until explicitly revoked
//
// Note: 'always' was removed in Phase 5. Existing 'always' grants in the
// database are mapped to 'workspace' at read time.
// =============================================================================

export type GrantScope = 'once' | 'session' | 'workspace';

// Backward compatibility alias
export type PermissionScope = GrantScope;

// =============================================================================
// Grant Matcher (for pattern matching grants)
// =============================================================================

export type GrantMatcher = 'exact' | 'prefix' | 'glob' | 'shell-command';

// Backward compatibility alias
export type PermissionMatcher = GrantMatcher;

// =============================================================================
// Permission Resource Type (canonical categories)
// 
// These are the first-class permission resource types that tools request.
// The shell-command type is new and handles the shell tool's special case.
// =============================================================================

export type PermissionResource =
  | 'file'
  | 'path'
  | 'directory'
  | 'shell-command'
  | 'network'
  | 'env'
  | 'clipboard'
  | string;

// Legacy compatibility alias
export type PermissionType = PermissionResource;

// =============================================================================
// Permission Decision (user's response)
// =============================================================================

export type PermissionDecision = 'granted' | 'denied' | 'timeout' | 'skipped';

// =============================================================================
// Permission Scope Definition (tool-authored scope for UI rendering)
// =============================================================================

export interface PermissionScopeDefinition {
  type: 'file' | 'path' | 'shell-command' | 'resource' | 'custom';
  value?: string;
  label?: string;
}

// =============================================================================
// Permission Ask (tool-authored, client-rendered)
// =============================================================================

export interface PermissionAsk {
  type: 'permission';
  question: string;
  description?: string;
  risk?: PermissionRiskLevel;
  resource?: PermissionResource;
  scope?: PermissionScopeDefinition | PermissionScopeDefinition[];
  duration?: GrantScope;
  patterns?: string[];
  paths?: string[];
  metadata?: Record<string, unknown>;
  /** Structured intents from shell effect analysis (Phase 3) */
  intents?: PermissionIntent[];
  /** Allowed scopes derived from intent analysis policy */
  allowedScopes?: GrantScope[];
  /** Action on the resource (e.g. 'read', 'write', 'delete') */
  action?: string;
}

// =============================================================================
// Permission Ask Response (user's decision)
// =============================================================================

export interface AskPermissionResponse {
  type: 'permission';
  grant: GrantScope | 'deny';
  scope?: string;
  duration?: number;
}

// =============================================================================
// Persisted Permission Grant (storage format)
// =============================================================================

export interface PermissionGrant {
  id: string;
  workspaceId: string;
  toolName: string;
  resource: PermissionResource;
  action?: string;
  scope: GrantScope;
  matcher: GrantMatcher;
  patterns: string[];
  allowed: boolean;
  grantedAt: string;
  expiresAt: string | null;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  metadata: Record<string, unknown> | null;
  /** For session-scoped grants: the root session ID this grant is bound to */
  boundRootSessionId?: string | null;
}

// =============================================================================
// Grant Creation Options (from tool's ask)
// =============================================================================

export interface PermissionGrantOptions {
  scope?: GrantScope;
  matcher?: GrantMatcher;
  action?: string;
  patterns?: string[];
  duration?: number;
  description?: string;
  /** For session-scoped grants: bind to this root session ID */
  boundRootSessionId?: string;
}

// =============================================================================
// Legacy Types (kept for backward compatibility only)
// =============================================================================

export type PermissionAction = string;
export type PersistedPermissionGrant = PermissionGrant;

// =============================================================================
// Security Check (tool use)
// =============================================================================

export interface SecurityCheckInput {
  args: Record<string, unknown>;
  workspacePath: string;
  sessionId: string;
  allowedPaths?: string[];
}

export interface SecurityCheckResult {
  allowed: boolean;
  requiresApproval: boolean;
  permissionType: string;
  permissionKey: string;
  message: string;
  details?: Record<string, unknown>;
}

// =============================================================================
// Shell-Specific Permission Helpers
// =============================================================================

export const SHELL_DANGEROUS_COMMANDS = [
  'rm', 'rmdir', 'del', 'erase',
  'sudo', 'su', 'doas',
  'chmod', 'chown',
  'dd', 'mkfs', 'format',
  'shutdown', 'reboot', 'halt',
  'iptables', 'ufw', 'firewall-cmd',
  'curl', 'wget', 'nc', 'netcat',
  'eval', 'exec',
] as const;

export const SHELL_FILESYSTEM_COMMANDS = [
  'mv', 'cp', 'mkdir', 'touch', 'ln',
  'git push', 'git reset --hard',
] as const;

export const SHELL_SHELL_OPERATORS = ['&&', '||', '|', '>', '>>', '`', '$(', ';'] as const;

export interface ParsedShellSegment {
  raw: string;
  baseCommand: string;
  args: string[];
  flags: string[];
}

export function splitShellCommandSegments(command: string): ParsedShellSegment[] {
  const normalized = command
    .replace(/&&|\|\||;|\||>>|>|`|\$\(/g, '\n')
    .split('\n')
    .map(part => part.trim())
    .filter(Boolean);

  return normalized.map((segment) => {
    const parts = segment.split(/\s+/);
    const baseCommand = parts[0]?.replace(/.*\//, '') || '';
    const args = parts.slice(1);
    const flags = args.filter(arg => arg.startsWith('-'));
    return {
      raw: segment,
      baseCommand,
      args,
      flags,
    };
  });
}

function normalizeShellCommandIdentity(segment: ParsedShellSegment): string {
  const base = segment.baseCommand;
  const firstNonFlagArg = segment.args.find(arg => !arg.startsWith('-'));

  if (!base) {
    return segment.raw;
  }

  if (base === 'git' && firstNonFlagArg) {
    return `git ${firstNonFlagArg}`;
  }

  if (['npm', 'pnpm', 'yarn', 'bun', 'cargo'].includes(base) && firstNonFlagArg) {
    return `${base} ${firstNonFlagArg}`;
  }

  return base;
}

function getShellCommandDangerPriority(identity: string): number {
  const lower = identity.toLowerCase();

  if (lower === 'shutdown' || lower === 'reboot' || lower === 'halt') return 5;
  if (lower === 'sudo' || lower === 'su' || lower === 'doas' || lower === 'chmod' || lower === 'chown') return 4;
  if (lower === 'rm' || lower.startsWith('rm ') || lower === 'rmdir' || lower === 'del' || lower === 'erase' || lower === 'dd' || lower === 'mkfs' || lower === 'format') return 3;
  if (lower === 'mv' || lower === 'cp' || lower === 'mkdir' || lower === 'touch' || lower === 'ln' || lower === 'git push' || lower === 'git reset') return 2;
  if (lower === 'curl' || lower === 'wget' || lower === 'nc' || lower === 'netcat' || lower === 'iptables' || lower === 'ufw' || lower === 'firewall-cmd' || lower === 'eval' || lower === 'exec') return 1;
  return 0;
}

export function getEffectiveShellCommandIdentity(command: string): string {
  const segments = splitShellCommandSegments(command);
  if (segments.length === 0) {
    return '';
  }

  let selectedIdentity = normalizeShellCommandIdentity(segments[0]);
  let selectedPriority = getShellCommandDangerPriority(selectedIdentity);

  for (const segment of segments.slice(1)) {
    const identity = normalizeShellCommandIdentity(segment);
    const priority = getShellCommandDangerPriority(identity);
    if (priority > selectedPriority) {
      selectedIdentity = identity;
      selectedPriority = priority;
    }
  }

  return selectedIdentity;
}

function isDangerousShellIdentity(identity: string): boolean {
  return getShellCommandDangerPriority(identity) > 0;
}

export const SENSITIVE_FILE_PATTERNS = [
  '.env', '.pem', '.key', '.ssh/', 'id_rsa', 'id_ed25519',
  '.gitconfig', '.npmrc', 'credentials', 'secrets', 'password',
  '.htpasswd',
] as const;

// =============================================================================
// Shell Permission Intent Analysis
//
// Analyzes shell commands into structured resource-target effects.
// This is the foundation for target-based permission grants:
//   "cat .env" → file read ".env"  (NOT "allow all cat commands")
//   "rm -rf build" → file delete "build/" subtree
//   "curl https://api.example.com" → network request "api.example.com"
// =============================================================================

export type PermissionIntentResource = 'file' | 'network' | 'shell-command';

export type PermissionIntentAction =
  | 'read'
  | 'write'
  | 'delete'
  | 'request'
  | 'execute';

export type PermissionTargetMatcher = 'exact' | 'prefix';

export interface PermissionTarget {
  /** Normalized absolute path, host, or other target identifier */
  target: string;
  /** How to match this target against future requests */
  matcher: PermissionTargetMatcher;
}

export interface PermissionIntent {
  /** The resource category this intent affects */
  resource: PermissionIntentResource;
  /** The action being performed on the resource */
  action: PermissionIntentAction;
  /** Normalized targets with match semantics */
  targets: PermissionTarget[];
  /** Whether this intent can produce reusable (non-once) grants */
  persistable: boolean;
  /**
   * Reason the intent is not persistable (when persistable=false).
   * E.g. "command contains shell operators" or "dynamic variable expansion"
   */
  nonPersistableReason?: string;
  /** Allowed scopes for this intent (computed from policy) */
  allowedScopes: GrantScope[];
}

export interface ShellEffectAnalysis {
  /** The original command string */
  command: string;
  /** Base command identity (e.g. "rm", "git push", "curl") */
  baseCommand: string;
  /** Shell risk category */
  riskCategory: ShellRiskCategory;
  /** Risk level */
  risk: PermissionRiskLevel;
  /** Whether the command has shell operators */
  hasOperators: boolean;
  /** Whether all referenced paths are within the workspace */
  workspaceBound: boolean;
  /** Resolved absolute paths from command arguments */
  resolvedPaths: string[];
  /** Human-readable reason for the permission ask */
  reason: string;
  /** Structured intents derived from command analysis */
  intents: PermissionIntent[];
  /** The effective command identity used for shell-command fallback */
  effectiveIdentity: string;
}

// =============================================================================
// Scope Policy: allowed scopes per intent type
// =============================================================================

const FILE_READ_ALLOWED_SCOPES: GrantScope[] = ['once', 'session', 'workspace'];
const FILE_WRITE_ALLOWED_SCOPES: GrantScope[] = ['once', 'session', 'workspace'];
const FILE_DELETE_ALLOWED_SCOPES: GrantScope[] = ['once', 'session'];
const NETWORK_REQUEST_ALLOWED_SCOPES: GrantScope[] = ['once', 'session', 'workspace'];
const SHELL_EXECUTE_ALLOWED_SCOPES: GrantScope[] = ['once', 'session'];

export function getAllowedScopesForIntent(intent: PermissionIntent): GrantScope[] {
  if (!intent.persistable) return ['once'];
  switch (intent.resource) {
    case 'file':
      switch (intent.action) {
        case 'read': return FILE_READ_ALLOWED_SCOPES;
        case 'write': return FILE_WRITE_ALLOWED_SCOPES;
        case 'delete': return FILE_DELETE_ALLOWED_SCOPES;
        default: return ['once'];
      }
    case 'network':
      return NETWORK_REQUEST_ALLOWED_SCOPES;
    case 'shell-command':
      return SHELL_EXECUTE_ALLOWED_SCOPES;
    default:
      return ['once'];
  }
}

// =============================================================================
// Shell Effect Analyzer
// =============================================================================

const FILE_READ_COMMANDS = ['cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat', 'ls', 'find', 'grep', 'awk', 'sed', 'sort', 'uniq', 'diff', 'comm', 'cut', 'tr', 'tee'] as const;
const FILE_WRITE_COMMANDS = ['touch', 'mkdir'] as const;
const FILE_DELETE_COMMANDS = ['rm', 'rmdir', 'del', 'erase'] as const;
const NETWORK_COMMANDS = ['curl', 'wget', 'nc', 'netcat'] as const;

type FileReadCommand = typeof FILE_READ_COMMANDS[number];
type FileWriteCommand = typeof FILE_WRITE_COMMANDS[number];
type FileDeleteCommand = typeof FILE_DELETE_COMMANDS[number];
type NetworkCommand = typeof NETWORK_COMMANDS[number];

function isFileReadCommand(cmd: string): cmd is FileReadCommand {
  return (FILE_READ_COMMANDS as readonly string[]).includes(cmd);
}

function isFileWriteCommand(cmd: string): cmd is FileWriteCommand {
  return (FILE_WRITE_COMMANDS as readonly string[]).includes(cmd);
}

function isFileDeleteCommand(cmd: string): cmd is FileDeleteCommand {
  return (FILE_DELETE_COMMANDS as readonly string[]).includes(cmd);
}

function isNetworkCommand(cmd: string): cmd is NetworkCommand {
  return (NETWORK_COMMANDS as readonly string[]).includes(cmd);
}

function _isOperatorCommand(command: string): boolean {
  return SHELL_SHELL_OPERATORS.some(op => command.includes(op));
}

function hasDynamicExpansion(command: string): boolean {
  return /\$\{?[^}]+\}?/.test(command) || command.includes('$(');
}

/**
 * Extract non-flag, non-command arguments from a shell command string.
 * Returns the arguments that likely represent file paths or targets.
 */
function _extractTargetArguments(command: string): string[] {
  const parts = command.trim().split(/\s+/);
  const args: string[] = [];
  let i = 1; // skip base command

  // Skip subcommand for git/npm/etc
  const base = parts[0]?.replace(/.*\//, '') || '';
  if (['git'].includes(base) && parts[1] && !parts[1].startsWith('-')) {
    i = 2; // skip "git" and "push"/etc
  }
  if (['npm', 'pnpm', 'yarn', 'bun', 'cargo'].includes(base) && parts[1] && !parts[1].startsWith('-')) {
    i = 2;
  }

  for (; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    // Skip flags
    if (part.startsWith('-')) continue;
    // Skip output redirection targets
    if (part === '>' || part === '>>') { i++; continue; }
    args.push(part);
  }
  return args;
}

/**
 * Analyze a shell command into structured permission intents.
 *
 * This is the core of the target-based permission system.
 * Instead of "allow cat", it produces "allow file read .env".
 */
export function analyzeShellCommandEffects(params: {
  command: string;
  baseCommand: string;
  resolvedPaths: string[];
  hasOperators: boolean;
  workspaceBound: boolean;
  riskCategory: ShellRiskCategory;
}): PermissionIntent[] {
  const { command, baseCommand, resolvedPaths, hasOperators, riskCategory } = params;
  const intents: PermissionIntent[] = [];
  const hasDynamic = hasDynamicExpansion(command);

  // If operators are present, the command is too complex for reliable target analysis
  if (hasOperators) {
    intents.push({
      resource: 'shell-command',
      action: 'execute',
      targets: [{ target: baseCommand, matcher: 'exact' }],
      persistable: false,
      nonPersistableReason: 'command contains shell operators',
      allowedScopes: ['once', 'session'],
    });
    return intents;
  }

  // Network commands
  if (isNetworkCommand(baseCommand)) {
    const targets = extractNetworkTargets(command, baseCommand);
    if (targets.length > 0) {
      const intent: PermissionIntent = {
        resource: 'network',
        action: 'request',
        targets,
        persistable: !hasDynamic,
        nonPersistableReason: hasDynamic ? 'dynamic variable expansion' : undefined,
        allowedScopes: [],
      };
      intent.allowedScopes = getAllowedScopesForIntent(intent);
      intents.push(intent);
    } else {
      // No extractable URL/host
      intents.push({
        resource: 'shell-command',
        action: 'execute',
        targets: [{ target: baseCommand, matcher: 'exact' }],
        persistable: false,
        nonPersistableReason: 'could not extract network target',
        allowedScopes: ['once', 'session'],
      });
    }
    return intents;
  }

  // File delete commands
  if (isFileDeleteCommand(baseCommand)) {
    if (resolvedPaths.length > 0 && !hasDynamic) {
      const isRecursive = command.includes('-r') || command.includes('-R') || command.includes('-rf');
      const targets = resolvedPaths.map(p => ({
        target: isRecursive ? ensureTrailingSlash(p) : p,
        matcher: isRecursive ? 'prefix' as const : 'exact' as const,
      }));
      const intent: PermissionIntent = {
        resource: 'file',
        action: 'delete',
        targets,
        persistable: true,
        allowedScopes: [],
      };
      intent.allowedScopes = getAllowedScopesForIntent(intent);
      intents.push(intent);
    } else {
      intents.push({
        resource: 'shell-command',
        action: 'execute',
        targets: [{ target: baseCommand, matcher: 'exact' }],
        persistable: false,
        nonPersistableReason: hasDynamic ? 'dynamic variable expansion' : 'could not resolve target paths',
        allowedScopes: ['once'],
      });
    }
    return intents;
  }

  // File read commands
  if (isFileReadCommand(baseCommand)) {
    if (resolvedPaths.length > 0 && !hasDynamic) {
      const targets = resolvedPaths.map(p => ({
        target: p,
        matcher: 'exact' as const,
      }));
      const intent: PermissionIntent = {
        resource: 'file',
        action: 'read',
        targets,
        persistable: true,
        allowedScopes: [],
      };
      intent.allowedScopes = getAllowedScopesForIntent(intent);
      intents.push(intent);
    } else if (resolvedPaths.length === 0) {
      // File read command with no resolved paths (e.g., "cat" alone or piping)
      // This is a shell-execute fallback
      intents.push({
        resource: 'shell-command',
        action: 'execute',
        targets: [{ target: baseCommand, matcher: 'exact' }],
        persistable: false,
        nonPersistableReason: 'no resolvable file targets',
        allowedScopes: ['once', 'session'],
      });
    } else {
      // Has dynamic expansion
      intents.push({
        resource: 'shell-command',
        action: 'execute',
        targets: [{ target: baseCommand, matcher: 'exact' }],
        persistable: false,
        nonPersistableReason: 'dynamic variable expansion',
        allowedScopes: ['once'],
      });
    }
    return intents;
  }

  // File write / modification commands (mv, cp, mkdir, touch, ln)
  if (isFileWriteCommand(baseCommand) || ['mv', 'cp', 'ln'].includes(baseCommand)) {
    if (resolvedPaths.length > 0 && !hasDynamic) {
      const targets = resolvedPaths.map(p => ({
        target: p,
        matcher: 'exact' as const,
      }));
      const intent: PermissionIntent = {
        resource: 'file',
        action: 'write',
        targets,
        persistable: true,
        allowedScopes: [],
      };
      intent.allowedScopes = getAllowedScopesForIntent(intent);
      intents.push(intent);
    } else {
      intents.push({
        resource: 'shell-command',
        action: 'execute',
        targets: [{ target: baseCommand, matcher: 'exact' }],
        persistable: false,
        nonPersistableReason: hasDynamic ? 'dynamic variable expansion' : 'could not resolve target paths',
        allowedScopes: ['once'],
      });
    }
    return intents;
  }

  // Sensitive files category — even if command isn't a known file reader,
  // if it references sensitive files, produce a file-read intent
  if (riskCategory === 'sensitive-files' && resolvedPaths.length > 0 && !hasDynamic) {
    const targets = resolvedPaths.map(p => ({
      target: p,
      matcher: 'exact' as const,
    }));
    const intent: PermissionIntent = {
      resource: 'file',
      action: 'read',
      targets,
      persistable: true,
      allowedScopes: [],
    };
    intent.allowedScopes = getAllowedScopesForIntent(intent);
    intents.push(intent);
    return intents;
  }

  // All other dangerous/system commands that we can't classify
  // (sudo, chmod, chown, shutdown, eval, etc.)
  intents.push({
    resource: 'shell-command',
    action: 'execute',
    targets: [{ target: baseCommand, matcher: 'exact' }],
    persistable: false,
    nonPersistableReason: 'unclassifiable system command',
    allowedScopes: ['once', 'session'],
  });
  return intents;
}

function ensureTrailingSlash(path: string): string {
  if (path.endsWith('/')) return path;
  return path + '/';
}

function extractNetworkTargets(command: string, _baseCommand: string): PermissionTarget[] {
  const targets: PermissionTarget[] = [];
  const urlRegex = /https?:\/\/([^\s/$.?#].[^\s]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(command)) !== null) {
    const fullUrl = match[0];
    const host = match[1].split('/')[0];
    if (host) {
      targets.push({
        target: host,
        matcher: 'exact',
      });
    }
    // Also store the full URL prefix as a secondary target
    if (fullUrl.length > host.length + 8) { // more than just "http://host"
      const pathPrefix = fullUrl.substring(0, fullUrl.indexOf('/', 8) + 1);
      if (pathPrefix && pathPrefix.length > 8) {
        targets.push({
          target: pathPrefix,
          matcher: 'prefix',
        });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return targets.filter(t => {
    if (seen.has(t.target)) return false;
    seen.add(t.target);
    return true;
  });
}

// =============================================================================
// Canonical Shell Permission Helpers
// =============================================================================

export type ShellRiskCategory = 'destructive' | 'side-effect' | 'workspace-modification' | 'network' | 'outside-workspace' | 'sensitive-files';

/**
 * Create a shell permission ask with structured intent analysis.
 *
 * This function now runs the shell effect analyzer to produce target-based
 * intents instead of command-identity patterns. For example:
 * - "cat .env" → resource='file', action='read', target='/workspace/.env'
 * - "rm -rf build" → resource='file', action='delete', target='build/' (prefix)
 * - "curl https://api.example.com" → resource='network', action='request', target='api.example.com'
 *
 * Falls back to resource='shell-command' when analysis can't extract targets.
 */
export function createShellPermissionAskStructured(params: {
  command: string;
  baseCommand: string;
  flags: string[];
  risk: PermissionRiskLevel;
  riskCategory: ShellRiskCategory;
  reason: string;
  resolvedPaths?: string[];
  workspaceBound: boolean;
  hasOperators: boolean;
}): PermissionAsk {
  const commandIdentity = getEffectiveShellCommandIdentity(params.command);

  // Run the intent analysis
  const intents = analyzeShellCommandEffects({
    command: params.command,
    baseCommand: params.baseCommand,
    resolvedPaths: params.resolvedPaths ?? [],
    hasOperators: params.hasOperators,
    workspaceBound: params.workspaceBound,
    riskCategory: params.riskCategory,
  });

  // Use the primary intent to determine resource, action, and scope
  const primaryIntent = intents[0];

  // Determine the effective resource and action from the primary intent
  const effectiveResource: PermissionResource = primaryIntent?.resource ?? 'shell-command';
  const effectiveAction = primaryIntent?.action;

  // Build patterns from intent targets (not command identity)
  const patterns: string[] = [];
  if (primaryIntent) {
    for (const t of primaryIntent.targets) {
      patterns.push(t.target);
    }
  } else if (commandIdentity) {
    patterns.push(commandIdentity);
  }

  // Compute allowed scopes from policy
  const allAllowedScopes = intents.flatMap(i => i.allowedScopes);
  const allowedScopes = [...new Set(allAllowedScopes)];

  // Determine max suggested duration based on policy
  let duration: GrantScope = 'workspace';
  if (params.riskCategory === 'destructive' || params.riskCategory === 'network' || isDangerousShellIdentity(commandIdentity)) {
    duration = 'session';
  }
  // Enforce: if the intent is not persistable, cap at 'session'
  if (primaryIntent && !primaryIntent.persistable) {
    duration = allowedScopes.includes('session') ? 'session' : 'once';
  }

  // Build scope definition from primary intent
  const scope = buildScopeFromIntent(primaryIntent, commandIdentity, params.flags);

  // Build human-readable question with target info
  const question = buildShellQuestion(params, primaryIntent);

  return {
    type: 'permission',
    question,
    risk: params.risk,
    resource: effectiveResource,
    action: effectiveAction,
    scope,
    patterns,
    duration,
    intents,
    allowedScopes,
    paths: params.resolvedPaths,
    metadata: {
      command: params.command,
      baseCommand: commandIdentity,
      flags: params.flags,
      riskCategory: params.riskCategory,
      reason: params.reason,
      resolvedPaths: params.resolvedPaths,
      workspaceBound: params.workspaceBound,
      hasOperators: params.hasOperators,
      effectiveResource,
      effectiveAction,
      description: buildDescription({
        baseCommand: commandIdentity,
        flags: params.flags,
        riskCategory: params.riskCategory,
        workspaceBound: params.workspaceBound,
        hasOperators: params.hasOperators,
      }),
    },
  };
}

function buildScopeFromIntent(
  intent: PermissionIntent | undefined,
  commandIdentity: string,
  flags: string[],
): PermissionScopeDefinition {
  if (!intent) {
    return {
      type: 'shell-command',
      value: commandIdentity,
      label: formatCommandLabel(commandIdentity, flags),
    };
  }

  switch (intent.resource) {
    case 'file':
      return {
        type: 'file',
        value: intent.targets.map(t => t.target).join(', '),
        label: `${intent.action} ${intent.targets.map(t => t.target.split('/').pop() || t.target).join(', ')}`,
      };
    case 'network':
      return {
        type: 'resource',
        value: intent.targets.map(t => t.target).join(', '),
        label: intent.targets.map(t => t.target).join(', '),
      };
    case 'shell-command':
      return {
        type: 'shell-command',
        value: commandIdentity,
        label: formatCommandLabel(commandIdentity, flags),
      };
    default:
      return {
        type: 'shell-command',
        value: commandIdentity,
        label: formatCommandLabel(commandIdentity, flags),
      };
  }
}

function buildShellQuestion(
  params: {
    command: string;
    risk: PermissionRiskLevel;
    riskCategory: ShellRiskCategory;
    reason: string;
    workspaceBound: boolean;
    resolvedPaths?: string[];
  },
  intent: PermissionIntent | undefined,
): string {
  // Build a more descriptive question when we have intent info
  if (intent && intent.resource === 'file') {
    const targetNames = intent.targets.map(t => t.target.split('/').pop() || t.target);
    const actionLabel = intent.action === 'read' ? 'Read' : intent.action === 'write' ? 'Write to' : intent.action === 'delete' ? 'Delete' : 'Access';
    let question = `${actionLabel} file "${targetNames.join('", "')}"`;
    if (!params.workspaceBound) {
      question += ' (outside workspace)';
    }
    question += `. Requires approval.`;
    return question;
  }

  if (intent && intent.resource === 'network') {
    const hosts = intent.targets.filter(t => t.matcher === 'exact').map(t => t.target);
    if (hosts.length > 0) {
      return `Network request to "${hosts.join('", "')}" via ${truncateCommand(params.command)}. Requires approval.`;
    }
  }

  // Fallback: original question format
  let question = `Run command "${truncateCommand(params.command)}"`;
  if (params.workspaceBound) {
    question += ` (within workspace)`;
  } else {
    question += ` (references paths outside workspace)`;
  }
  question += `: ${params.reason}. Requires approval.`;
  return question;
}

export function createOutsideWorkspaceAsk(params: {
  command: string;
  cwd: string;
  resolvedPaths: string[];
  hasOperators?: boolean;
}): PermissionAsk {
  const commandIdentity = getEffectiveShellCommandIdentity(params.command);

  const intents = analyzeShellCommandEffects({
    command: params.command,
    baseCommand: commandIdentity,
    resolvedPaths: params.resolvedPaths,
    hasOperators: params.hasOperators ?? false,
    workspaceBound: false,
    riskCategory: 'outside-workspace',
  });

  const primaryIntent = intents[0];
  const effectiveResource: PermissionResource = primaryIntent?.resource ?? 'shell-command';

  const allAllowedScopes = intents.flatMap(i => i.allowedScopes);
  const allowedScopes = [...new Set(allAllowedScopes)];

  const patterns: string[] = [];
  if (primaryIntent) {
    for (const t of primaryIntent.targets) {
      patterns.push(t.target);
    }
  }
  if (patterns.length === 0) {
    patterns.push(commandIdentity || `cwd:${params.cwd}`);
  }

  const scope: PermissionScopeDefinition = {
    type: 'path',
    value: params.cwd,
    label: params.cwd.split('/').pop() || params.cwd,
  };

  return {
    type: 'permission',
    question: `Command "${truncateCommand(params.command)}" runs in directory outside workspace (${params.cwd}). Requires approval.`,
    risk: 'medium',
    resource: effectiveResource,
    action: primaryIntent?.action,
    scope,
    patterns,
    duration: 'session',
    intents,
    allowedScopes,
    metadata: {
      command: params.command,
      baseCommand: commandIdentity,
      cwd: params.cwd,
      resolvedPaths: params.resolvedPaths,
      riskCategory: 'outside-workspace',
      effectiveResource,
      effectiveAction: primaryIntent?.action,
      description: `External directory access: ${params.cwd}`,
      hasOperators: params.hasOperators ?? false,
    },
  };
}

export function createWorkspaceModificationAsk(params: {
  command: string;
  baseCommand: string;
  resolvedPaths: string[];
  hasOperators?: boolean;
}): PermissionAsk {
  const commandIdentity = getEffectiveShellCommandIdentity(params.command);

  const intents = analyzeShellCommandEffects({
    command: params.command,
    baseCommand: params.baseCommand,
    resolvedPaths: params.resolvedPaths,
    hasOperators: params.hasOperators ?? false,
    workspaceBound: true,
    riskCategory: 'workspace-modification',
  });

  const primaryIntent = intents[0];
  const effectiveResource: PermissionResource = primaryIntent?.resource ?? 'shell-command';
  const effectiveAction = primaryIntent?.action;

  const allAllowedScopes = intents.flatMap(i => i.allowedScopes);
  const allowedScopes = [...new Set(allAllowedScopes)];

  const patterns: string[] = [];
  if (primaryIntent) {
    for (const t of primaryIntent.targets) {
      patterns.push(t.target);
    }
  }
  if (patterns.length === 0) {
    patterns.push(commandIdentity || params.baseCommand);
  }

  // Build better question for file-targeted operations
  let question: string;
  if (primaryIntent && primaryIntent.resource === 'file') {
    const targetNames = primaryIntent.targets.map(t => t.target.split('/').pop() || t.target);
    const actionLabel = primaryIntent.action === 'write' ? 'Write to' : primaryIntent.action === 'read' ? 'Read' : 'Modify';
    question = `${actionLabel} "${targetNames.join('", "')}" via ${truncateCommand(params.command)}. Requires approval.`;
  } else {
    question = `Run filesystem command "${truncateCommand(params.command)}" within workspace. Requires approval.`;
  }

  const scope = buildScopeFromIntent(primaryIntent, commandIdentity, []);

  return {
    type: 'permission',
    question,
    risk: 'medium',
    resource: effectiveResource,
    action: effectiveAction,
    scope,
    patterns,
    duration: 'session',
    intents,
    allowedScopes,
    paths: params.resolvedPaths,
    metadata: {
      command: params.command,
      baseCommand: commandIdentity || params.baseCommand,
      resolvedPaths: params.resolvedPaths,
      riskCategory: 'workspace-modification',
      effectiveResource,
      effectiveAction,
      description: `Workspace filesystem: ${commandIdentity || params.baseCommand}`,
      hasOperators: params.hasOperators ?? false,
    },
  };
}

function truncateCommand(cmd: string, maxLen = 80): string {
  return cmd.length > maxLen ? cmd.slice(0, maxLen) + '...' : cmd;
}

function formatCommandLabel(baseCommand: string, flags: string[]): string {
  if (!baseCommand) {
    return '';
  }
  if (flags.length === 0) {
    return baseCommand;
  }
  const commonFlags = flags.slice(0, 3).join(' ');
  return commonFlags ? `${baseCommand} ${commonFlags}` : baseCommand;
}

function buildDescription(params: {
  baseCommand: string;
  flags: string[];
  riskCategory: ShellRiskCategory;
  workspaceBound: boolean;
  hasOperators: boolean;
}): string {
  const parts: string[] = [];

  switch (params.riskCategory) {
    case 'destructive':
      parts.push('Destructive operation');
      break;
    case 'network':
      parts.push('Network access');
      break;
    case 'side-effect':
      parts.push('Side-effect command');
      break;
    case 'workspace-modification':
      parts.push('Workspace modification');
      break;
    case 'outside-workspace':
      parts.push('Outside workspace');
      break;
  }

  if (!params.workspaceBound) {
    parts.push('References external paths');
  }

  if (params.hasOperators) {
    parts.push('Contains shell operators');
  }

  return parts.join(' • ');
}

export function createFilePermissionAsk(params: {
  path: string;
  operation: 'read' | 'write' | 'edit';
  risk: PermissionRiskLevel;
  reason?: string;
  isOutsideWorkspace?: boolean;
  isSensitiveFile?: boolean;
}): PermissionAsk {
  const operationLabel = params.operation === 'read' ? 'Reading' : params.operation === 'write' ? 'Writing' : 'Editing';
  const fileName = params.path.split('/').pop() || params.path;

  let question = `${operationLabel} file "${fileName}"`;

  if (params.isSensitiveFile) {
    question += ' (sensitive file)';
  } else if (params.isOutsideWorkspace) {
    question += ' (outside workspace)';
  }

  question += ' requires approval.';

  if (params.reason) {
    question += ` ${params.reason}`;
  }

  const patterns: string[] = [];
  patterns.push(`file:${params.path}`);
  patterns.push(`file:${fileName}`);

  if (params.isOutsideWorkspace) {
    patterns.push('outside-workspace');
  }

  if (params.isSensitiveFile) {
    patterns.push('sensitive-file');
  }

  let duration: GrantScope = 'workspace';
  if (params.isSensitiveFile || params.risk === 'high' || params.risk === 'critical') {
    duration = 'session';
  }

  return {
    type: 'permission',
    question,
    risk: params.risk,
    resource: 'file',
    paths: [params.path],
    patterns,
    duration,
    metadata: {
      operation: params.operation,
      path: params.path,
      fileName,
      isOutsideWorkspace: params.isOutsideWorkspace ?? false,
      isSensitiveFile: params.isSensitiveFile ?? false,
      reason: params.reason,
    },
  };
}

export function createWebfetchPermissionAsk(params: {
  url: string;
  host: string;
  risk: PermissionRiskLevel;
  reason?: string;
  isHttp?: boolean;
}): PermissionAsk {
  let question = `Fetch URL "${params.host}"`;

  if (params.isHttp) {
    question += ' (unencrypted HTTP)';
  }

  question += ' requires approval.';

  if (params.reason) {
    question += ` ${params.reason}`;
  }

  const patterns: string[] = [params.host, params.url];

  let duration: GrantScope = 'workspace';
  if (params.isHttp || params.risk === 'high' || params.risk === 'critical') {
    duration = 'session';
  }

  return {
    type: 'permission',
    question,
    risk: params.risk,
    resource: 'network',
    scope: {
      type: 'resource',
      value: params.url,
      label: params.host,
    },
    patterns,
    duration,
    metadata: {
      url: params.url,
      host: params.host,
      isHttp: params.isHttp ?? false,
      reason: params.reason,
    },
  };
}
