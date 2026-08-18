import type { PermissionAsk, PermissionRiskLevel } from '@capekai/tool';
import {
  addEntry,
  listEntries,
  removeEntry,
  replaceEntry,
  MEMORY_LINE_MEMORY_TARGET,
  MEMORY_LINE_NO_SECRETS,
  MEMORY_LINE_ONLY_COMPACT,
  MEMORY_LINE_USE_LIST,
  MEMORY_LINE_USER_TARGET,
  type MemoryActionResult,
  type MemoryTarget,
} from './registry';

export const memoryToolDefinition = {
  name: 'memory',
  description: `Persist durable workspace knowledge across sessions.

${MEMORY_LINE_USER_TARGET}
${MEMORY_LINE_MEMORY_TARGET}

Character limits: user=1500 chars, workspace=2500 chars. Keep entries compact.

Actions:
- list: Read current entries and char usage for a target. Requires target only.
- add: Append a new bullet entry. Requires content.
- replace: Find an entry by oldText substring and replace it. Requires oldText and content.
- remove: Find an entry by oldText substring and remove it. Requires oldText.

${MEMORY_LINE_USE_LIST}
${MEMORY_LINE_ONLY_COMPACT}
${MEMORY_LINE_NO_SECRETS}`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string' as const, enum: ['list', 'add', 'replace', 'remove'], description: 'The action to perform on the memory file.' },
      target: { type: 'string' as const, enum: ['user', 'memory'], description: 'Which memory file to modify. "user" for preferences, "memory" for workspace facts.' },
      content: { type: 'string' as const, description: 'The new content for add/replace actions.' },
      oldText: { type: 'string' as const, description: 'The text to find for replace/remove actions. Must match exactly one entry.' },
    },
    required: ['action', 'target'],
  },
  timeout: 10000,
};

export async function executeMemoryTool(input: Record<string, unknown>, basePath: string, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>): Promise<MemoryActionResult> {
  const action = input.action as 'list' | 'add' | 'replace' | 'remove';
  const target = input.target as MemoryTarget;
  const content = input.content as string | undefined;
  const oldText = input.oldText as string | undefined;
  if (!['list', 'add', 'replace', 'remove'].includes(action)) return { success: false, error: 'Invalid action. Must be list, add, replace, or remove.' };
  if (!['user', 'memory'].includes(target)) return { success: false, error: 'Invalid target. Must be user or memory.' };
  if (action === 'list') return listEntries(basePath, target);
  if ((action === 'add' || action === 'replace') && typeof content !== 'string') {
    return { success: false, error: `Content is required for ${action} action.` };
  }
  if ((action === 'replace' || action === 'remove') && typeof oldText !== 'string') {
    return { success: false, error: `oldText is required for ${action} action.` };
  }
  if (risk !== 'none' && askFn) {
    const approved = await askFn({
      type: 'permission', question: `Allow memory ${action} on ${target}?`,
      description: `Action: ${action}\nTarget: ${target}${content ? `\nContent: ${content.slice(0, 200)}` : ''}${oldText ? `\nOld text: ${oldText.slice(0, 200)}` : ''}`,
      risk, resource: 'file', action: 'write', paths: [target === 'user' ? 'USER.md' : 'MEMORY.md'],
    });
    if (!approved) return { success: false, error: 'USER_REJECTION' };
  }
  if (action === 'add') return content ? addEntry(basePath, target, content) : { success: false, error: 'Content is required for add action.' };
  if (action === 'replace') {
    if (!oldText) return { success: false, error: 'oldText is required for replace action.' };
    return content ? replaceEntry(basePath, target, oldText, content) : { success: false, error: 'Content is required for replace action.' };
  }
  return oldText ? removeEntry(basePath, target, oldText) : { success: false, error: 'oldText is required for remove action.' };
}
