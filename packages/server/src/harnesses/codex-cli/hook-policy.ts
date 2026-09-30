import { isAbsolute, resolve } from 'node:path';
import type { PermissionAsk } from '@prokopai/sdk';
import { createFilePermissionAsk } from '@prokopai/sdk';
import { classifyShellCommand, isSensitivePath, isWithinRoot } from '@/domains/permissions';

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

/** Return null for ordinary operations, undefined for unsupported/malformed input.
 * Shell policy comes from the shared permissions domain; only the native
 * apply_patch format is Codex-specific. */
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
    const outside = resolved.some(candidate => !isWithinRoot(candidate, root));
    const isSensitiveFile = resolved.some(isSensitivePath);
    const deleting = /^\*\*\* Delete File:/m.test(command);
    if (outside || isSensitiveFile || deleting) {
      const path = resolved.find(candidate => !isWithinRoot(candidate, root) || isSensitivePath(candidate)) ?? resolved[0]!;
      return { ...createFilePermissionAsk({ path, operation: 'edit', risk: 'high',
        isOutsideWorkspace: outside, isSensitiveFile, reason: deleting ? 'Codex is deleting a file.' : undefined }),
      paths: resolved, question: `Allow Codex to ${deleting ? 'delete or change' : 'change'} ${resolved.length} file(s)?` };
    }
    return null;
  }
  return classifyShellCommand(command, root, call.cwd);
}
