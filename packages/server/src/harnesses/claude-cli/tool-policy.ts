import { resolve } from 'node:path';
import type { PermissionRiskLevel } from '@prokopai/sdk';
import {
  classifyShellCommand,
  concernRisk,
  effectivePath,
  grantScopesForFinding,
  isOutsideRoot,
  isSensitivePath,
  requiresHumanReview,
  type Concern,
  type ConcernsPermissionAsk,
} from '@/domains/permissions';

const valid = (value: unknown): value is string => typeof value === 'string'
  && !!value.trim() && value.length <= 64 * 1024 && !value.includes('\0');

/** Undefined means no local classification needed (the tool runs); null means
 * a known tool has invalid input (deny). Shell policy comes from the shared
 * permissions domain; only the native file/web tool shapes are
 * Claude-specific. Asks carry the permissions-v2 concern fields, so the
 * approval decision (shouldAutoApproveAsk) follows the session mode. */
export function classifyClaudeTool(
  toolName: string,
  input: Record<string, unknown>,
  root: string,
): ConcernsPermissionAsk | null | undefined {
  const concerns: Concern[] = [];
  let description: string;
  let path: string | undefined;
  const resource = 'file';
  let action = 'read';

  if (toolName === 'Bash') {
    if (!valid(input.command)) return null;
    const classification = classifyShellCommand(input.command, root, root);
    if (!classification) return null;
    if (!requiresHumanReview(classification.finding)) return undefined;
    return { ...classification.ask,
      question: 'Allow Claude to run this command?',
      description: input.command.slice(0, 1000),
      metadata: { command: input.command.slice(0, 1000), toolName } };
  }

  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    if (!valid(input.file_path)
      || toolName === 'Edit' && (!valid(input.old_string) || typeof input.new_string !== 'string')
      || toolName === 'Write' && typeof input.content !== 'string') return null;
    path = resolve(root, input.file_path);
    const target = effectivePath(path);
    action = toolName === 'Read' ? 'read' : 'write';
    if (isSensitivePath(path) || isSensitivePath(target)) concerns.push('sensitive');
    if (isOutsideRoot(target, root)) concerns.push('escape');
    description = path;
  } else if (toolName === 'Glob' || toolName === 'Grep') {
    if (!valid(input.pattern) || input.path !== undefined && !valid(input.path)) return null;
    path = resolve(root, typeof input.path === 'string' ? input.path : '.');
    const target = effectivePath(path);
    if (isSensitivePath(path) || isSensitivePath(target) || isSensitivePath(input.pattern)) concerns.push('sensitive');
    if (isOutsideRoot(target, root)) concerns.push('escape');
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

  // Clean workspace file operations run without an ask at every mode; only
  // sensitive or outside-workspace targets ask.
  if (concerns.length === 0) return undefined;

  const finding = { concerns, catastrophic: false, evidence: [], resolvedPaths: [] };
  const risk: PermissionRiskLevel = concernRisk(finding);
  const ask: ConcernsPermissionAsk = { type: 'permission', question: `Allow Claude to use ${toolName}?`,
    description: description.slice(0, 1000), resource, action, risk,
    concerns, catastrophic: false,
    allowedScopes: grantScopesForFinding(finding),
    ...(path ? { paths: [path] } : {}), metadata: { toolName } };
  return ask;
}
