import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, dirname } from 'node:path';
import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import { SENSITIVE_FILE_PATTERNS } from '@prokopai/sdk';
import { classifyCodexHook } from '../codex-cli/hook-policy';

const sensitive = (path: string): boolean => SENSITIVE_FILE_PATTERNS.some(pattern => path.toLowerCase().includes(pattern));
const valid = (value: unknown): value is string => typeof value === 'string'
  && !!value.trim() && value.length <= 64 * 1024 && !value.includes('\0');

function outside(path: string, root: string): boolean {
  const offset = relative(root, path);
  return offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset);
}

// Follow existing ancestors so an existing symlink cannot turn a low-risk read/write into an outside-root operation.
function effectivePath(path: string): string {
  let ancestor = path;
  while (true) {
    try {
      return resolve(realpathSync(ancestor), relative(ancestor, path));
    } catch {
      const parent = dirname(ancestor);
      if (parent === ancestor) return path;
      ancestor = parent;
    }
  }
}

/** Undefined means no local classification; null means a known tool has invalid input. */
export function classifyClaudeTool(toolName: string, input: Record<string, unknown>, root: string): PermissionAsk | null | undefined {
  let risk: PermissionRiskLevel;
  let resource = 'file';
  let action = 'read';
  let description: string;
  let path: string | undefined;

  if (toolName === 'Bash') {
    if (!valid(input.command)) return null;
    const ask = classifyCodexHook({ session_id: 'claude', turn_id: 'claude', tool_use_id: 'claude',
      hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Bash', tool_input: input }, root);
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
    risk = sensitive(path) || sensitive(target) || outside(target, root) ? 'high'
      : action === 'write' ? 'medium' : 'low';
    description = path;
  } else if (toolName === 'Glob' || toolName === 'Grep') {
    if (!valid(input.pattern) || input.path !== undefined && !valid(input.path)) return null;
    path = resolve(root, typeof input.path === 'string' ? input.path : '.');
    const target = effectivePath(path);
    risk = sensitive(path) || sensitive(target) || sensitive(input.pattern) || outside(target, root) ? 'high' : 'low';
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
