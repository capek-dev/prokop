import { resolve } from 'node:path';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { classifyShellCommand, effectivePath, isOutsideRoot, isSensitivePath } from '@/domains/permissions';

const valid = (value: unknown): value is string => typeof value === 'string'
  && !!value.trim() && value.length <= 64 * 1024 && !value.includes('\0');

/** Undefined means no local classification; null means a known tool has invalid input.
 * Shell policy comes from the shared permissions domain (same classifier the
 * Codex pre-tool hook uses); only the native file/web tool shapes are
 * Claude-specific. */
export function classifyClaudeTool(toolName: string, input: Record<string, unknown>, root: string): PermissionAsk | null | undefined {
  let risk: PermissionRiskLevel;
  let resource = 'file';
  let action = 'read';
  let description: string;
  let path: string | undefined;

  if (toolName === 'Bash') {
    if (!valid(input.command)) return null;
    const ask = classifyShellCommand(input.command, root, root);
    if (ask === undefined) return null;
    return { ...(ask ?? { type: 'permission', risk: 'low', resource: 'shell-command', action: 'execute',
      question: 'Allow Claude to run this command?' }),
    question: 'Allow Claude to run this command?', description: input.command.slice(0, 1000),
    allowedScopes: ['once'], metadata: { command: input.command.slice(0, 1000) } };
  }

  if (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') {
    if (!valid(input.file_path)
      || toolName === 'Edit' && (!valid(input.old_string) || typeof input.new_string !== 'string')
      || toolName === 'Write' && typeof input.content !== 'string') return null;
    path = resolve(root, input.file_path);
    const target = effectivePath(path);
    action = toolName === 'Read' ? 'read' : 'write';
    risk = isSensitivePath(path) || isSensitivePath(target) || isOutsideRoot(target, root) ? 'high'
      : action === 'write' ? 'medium' : 'low';
    description = path;
  } else if (toolName === 'Glob' || toolName === 'Grep') {
    if (!valid(input.pattern) || input.path !== undefined && !valid(input.path)) return null;
    path = resolve(root, typeof input.path === 'string' ? input.path : '.');
    const target = effectivePath(path);
    risk = isSensitivePath(path) || isSensitivePath(target) || isSensitivePath(input.pattern) || isOutsideRoot(target, root) ? 'high' : 'low';
    description = `${input.pattern} in ${path}`;
  } else if (toolName === 'WebFetch') {
    if (!valid(input.url)) return null;
    try {
      const url = new URL(input.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    } catch { return null; }
    resource = 'network';
    action = 'fetch';
    risk = 'high';
    description = input.url;
  } else if (toolName === 'WebSearch') {
    if (!valid(input.query)) return null;
    resource = 'network';
    action = 'search';
    risk = 'medium';
    description = input.query;
  } else return undefined;

  return { type: 'permission', question: `Allow Claude to use ${toolName}?`,
    description: description.slice(0, 1000), resource, action, risk, allowedScopes: ['once'],
    ...(path ? { paths: [path] } : {}), metadata: { toolName } };
}
