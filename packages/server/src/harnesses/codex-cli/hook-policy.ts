import { isAbsolute, relative, resolve } from 'node:path';
import type { PermissionAsk } from '@prokopai/sdk';
import { createFilePermissionAsk, createShellPermissionAskStructured, createWorkspaceModificationAsk,
  SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';
import { analyzeRisk } from '@/tools/builtin/shell/risk';

export interface CodexHookCall {
  session_id: string;
  turn_id: string;
  tool_use_id: string;
  hook_event_name: string;
  cwd: string;
  tool_name: string;
  tool_input: unknown;
}

export function validHookCall(value: unknown): value is CodexHookCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const call = value as Record<string, unknown>;
  return call.hook_event_name === 'PreToolUse' && isAbsolute(String(call.cwd))
    && ['session_id', 'turn_id', 'tool_use_id', 'cwd'].every(key =>
      typeof call[key] === 'string' && (call[key] as string).length > 0 && (call[key] as string).length <= 512)
    && (call.tool_name === 'Bash' || call.tool_name === 'apply_patch');
}

function within(path: string, root: string): boolean {
  const suffix = relative(root, path);
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(suffix);
}

function sensitive(path: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some(pattern => path.toLowerCase().includes(pattern));
}

/** Return null for ordinary operations, undefined for unsupported/malformed input. */
export function classifyCodexHook(call: CodexHookCall, root: string): PermissionAsk | null | undefined {
  const input = call.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || !command.trim() || command.length > 64 * 1024) return undefined;
  if (call.tool_name === 'apply_patch') {
    const paths = [...command.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/gm)].map(match => match[1]!.trim());
    if (!paths.length || paths.length > 100) return undefined;
    if (paths.some(candidate => !candidate || candidate.includes('\0'))) return undefined;
    const resolved = paths.map(candidate => resolve(call.cwd, candidate));
    const outside = resolved.some(candidate => !within(candidate, root));
    const isSensitiveFile = resolved.some(sensitive);
    const deleting = /^\*\*\* Delete File:/m.test(command);
    if (outside || isSensitiveFile || deleting) {
      const path = resolved.find(candidate => !within(candidate, root) || sensitive(candidate)) ?? resolved[0]!;
      return { ...createFilePermissionAsk({ path, operation: 'edit', risk: 'high',
        isOutsideWorkspace: outside, isSensitiveFile, reason: deleting ? 'Codex is deleting a file.' : undefined }),
      paths: resolved, question: `Allow Codex to ${deleting ? 'delete or change' : 'change'} ${resolved.length} file(s)?` };
    }
    return null;
  }
  // Codex wraps unified exec in a login shell; inspect the inner command if present.
  const match = command.match(/^\/(?:bin\/)?(?:zsh|bash|sh)\s+-lc\s+'([\s\S]*)'$/);
  const effective = match ? match[1]!.replace(/'\\''/g, "'") : command;
  const risk = analyzeRisk(effective, {
    workspacePath: root,
    fs: { tempDir: '/__prokop_no_temp_exception__' },
    resolvePath: path => resolve(call.cwd, path),
    isWithinWorkspace: path => within(path, root),
    isSensitivePath: sensitive,
  } as Parameters<typeof analyzeRisk>[1], call.cwd);
  if (!risk.requiresAsk) return null;
  if (risk.riskCategory === 'workspace-modification') return createWorkspaceModificationAsk({
    command: effective, baseCommand: risk.baseCommand, resolvedPaths: risk.resolvedPaths, hasOperators: risk.hasOperators,
  });
  return createShellPermissionAskStructured({ command: effective, baseCommand: risk.baseCommand,
    flags: risk.flags, risk: risk.risk, riskCategory: risk.riskCategory, reason: risk.reason,
    resolvedPaths: risk.resolvedPaths, workspaceBound: risk.workspaceBound, hasOperators: risk.hasOperators });
}
