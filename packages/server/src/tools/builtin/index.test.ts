import { describe, expect, test } from 'bun:test';
import { builtinTools, builtinToolNames, isBuiltinToolName } from './index';

describe('built-in tool catalog', () => {
  test('exposes the full baked-in set', () => {
    expect([...builtinToolNames].sort()).toEqual([
      'apply-patch',
      'browser_discover_elements',
      'browser_dom_action',
      'browser_navigate',
      'browser_read_active_tab',
      'browser_screenshot',
      'browser_tab_manage',
      'edit',
      'edit-range',
      'file-to-markdown',
      'git-worktree',
      'glob',
      'grep',
      'ls',
      'multiedit',
      'question',
      'read-file',
      'shell',
      'tavily-search',
      'terminal',
      'todoread',
      'todowrite',
      'webfetch',
      'write-file',
    ]);
  });

  test('every tool has a valid definition and executor', () => {
    expect(builtinTools).toHaveLength(24);
    for (const tool of builtinTools) {
      expect(tool.definition.name).toBeTruthy();
      expect(tool.definition.description).toBeTruthy();
      expect(tool.definition.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  test('marks tools with the builtin source path', () => {
    for (const tool of builtinTools) {
      expect(tool.path).toBe('builtin:prokopai');
    }
  });

  test('isBuiltinToolName matches catalog names only', () => {
    expect(isBuiltinToolName('read-file')).toBe(true);
    expect(isBuiltinToolName('browser_navigate')).toBe(true);
    expect(isBuiltinToolName('file-to-markdown')).toBe(true);
    expect(isBuiltinToolName('shell')).toBe(true);
    expect(isBuiltinToolName('tavily-search')).toBe(true);
    expect(isBuiltinToolName('')).toBe(false);
  });
});
