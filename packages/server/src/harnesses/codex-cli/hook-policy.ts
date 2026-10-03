import { isAbsolute, resolve } from 'node:path';
import {
  classifyFileOperation,
  classifyShellCommand,
  requiresHumanReview,
  type ConcernsPermissionAsk,
} from '@/domains/permissions';
import type { SessionPermissionRoots } from '@/harnesses/shared/permission-roots';

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

/** Return null for ordinary operations (auto-run), undefined for unsupported/
 * malformed input. The ask carries the permissions-v2 concern fields, so the
 * approval decision (shouldAutoApproveAsk) follows the session mode. Only the
 * native apply_patch format is Codex-specific. */
export function classifyCodexHook(
  call: CodexHookCall, allowed: SessionPermissionRoots,
): ConcernsPermissionAsk | null | undefined {
  const input = call.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || !command.trim() || command.length > 64 * 1024) return undefined;
  if (call.tool_name === 'apply_patch') {
    const paths = [...command.matchAll(/^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/gm)].map(match => match[1]!.trim());
    if (!paths.length || paths.length > 100) return undefined;
    if (paths.some(candidate => !candidate || candidate.includes('\0'))) return undefined;
    const resolved = paths.map(candidate => resolve(call.cwd, candidate));
    const deleting = /^\*\*\* Delete File:/m.test(command);
    const classification = classifyFileOperation({
      operation: deleting ? 'delete' : 'edit',
      paths: resolved,
      roots: allowed.roots,
    });
    if (!classification) return undefined;
    if (!requiresHumanReview(classification.finding)) return null;
    return { ...classification.ask,
      question: `Allow Codex to ${deleting ? 'delete or change' : 'change'} ${resolved.length} file(s)?` };
  }
  const classification = classifyShellCommand(command, allowed.roots, call.cwd, { readRoots: allowed.readRoots });
  if (!classification) return undefined;
  if (!requiresHumanReview(classification.finding)) return null;
  return { ...classification.ask,
    question: 'Allow Codex to run this command?',
    description: command.slice(0, 1000) };
}
