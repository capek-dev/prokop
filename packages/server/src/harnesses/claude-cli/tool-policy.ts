import { resolve } from 'node:path';
import {
  classifyFileOperation,
  classifyShellCommand,
  requiresHumanReview,
  type ConcernsPermissionAsk,
  type FileOperation,
} from '@/domains/permissions';
import type { SessionPermissionRoots } from '@/harnesses/shared/permission-roots';

const valid = (value: unknown): value is string => typeof value === 'string'
  && !!value.trim() && value.length <= 64 * 1024 && !value.includes('\0');

/** Undefined means no local classification needed (the tool runs); null means
 *  a known tool has invalid input (deny). Shell and file policy both come
 *  from the shared permissions domain (classifyShellCommand,
 *  classifyFileOperation); only the native tool input shapes are
 *  Claude-specific. Asks carry the permissions-v2 concern fields, so the
 *  approval decision (shouldAutoApproveAsk) follows the session mode. */
export function classifyClaudeTool(
  toolName: string,
  input: Record<string, unknown>,
  root: string,
  allowed: SessionPermissionRoots = { roots: [root], readRoots: [] },
): ConcernsPermissionAsk | null | undefined {
  if (toolName === 'Bash') {
    if (!valid(input.command)) return null;
    const classification = classifyShellCommand(input.command, allowed.roots, root,
      { readRoots: allowed.readRoots });
    if (!classification) return null;
    if (!requiresHumanReview(classification.finding)) return undefined;
    return { ...classification.ask,
      question: 'Allow Claude to run this command?',
      description: input.command.slice(0, 1000),
      // The classified command: the ask's highlights and segments index it.
      metadata: { ...classification.ask.metadata, toolName } };
  }

  let operation: FileOperation | undefined;
  let path: string | undefined;
  let description: string | undefined;
  let pattern: string | undefined;

  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    if (!valid(input.file_path)
      || toolName === 'Edit' && (!valid(input.old_string) || typeof input.new_string !== 'string')
      || toolName === 'Write' && typeof input.content !== 'string') return null;
    operation = toolName === 'Read' ? 'read' : toolName === 'Write' ? 'write' : 'edit';
    path = resolve(root, input.file_path);
    description = path;
  } else if (toolName === 'Glob' || toolName === 'Grep') {
    if (!valid(input.pattern) || input.path !== undefined && !valid(input.path)) return null;
    operation = 'search';
    pattern = input.pattern;
    path = resolve(root, typeof input.path === 'string' ? input.path : '.');
    description = `${input.pattern} in ${path}`;
  } else if (toolName === 'WebFetch') {
    if (!valid(input.url)) return null;
    try {
      const url = new URL(input.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    } catch { return null; }
    // Plain network fetches run without an ask (the permissions v2 curl
    // decision); pipe-to-shell equivalents cannot arrive through WebFetch.
    return undefined;
  } else if (toolName === 'WebSearch') {
    if (!valid(input.query)) return null;
    return undefined;
  } else return undefined;

  // Shared file-operation classification: clean workspace file operations run
  // without an ask at every mode; only sensitive or outside-workspace targets
  // (or sensitive search patterns) ask.
  const classification = classifyFileOperation({
    operation: operation!,
    paths: [path!],
    roots: allowed.roots,
    readRoots: allowed.readRoots,
    pattern,
  });
  if (!classification) return null;
  if (!requiresHumanReview(classification.finding)) return undefined;
  return { ...classification.ask,
    question: `Allow Claude to use ${toolName}?`,
    description: description!.slice(0, 1000),
    metadata: { ...classification.ask.metadata, toolName } };
}
