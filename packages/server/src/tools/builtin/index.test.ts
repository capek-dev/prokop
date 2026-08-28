import { describe, expect, test } from 'bun:test';
import { builtinTools, builtinToolNames, isBuiltinToolName } from './index';

describe('built-in tool catalog', () => {
  test('exposes the full baked-in set', () => {
    expect([...builtinToolNames].sort()).toEqual([
      'apply-patch',
      'edit',
      'edit-range',
      'git-worktree',
      'glob',
      'grep',
      'ls',
      'multiedit',
      'question',
      'read-file',
      'shell',
      'terminal',
      'todoread',
      'todowrite',
      'webfetch',
      'write-file',
    ]);
  });

  test('every tool has a valid definition and executor', () => {
    expect(builtinTools).toHaveLength(16);
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
    expect(isBuiltinToolName('shell')).toBe(true);
    expect(isBuiltinToolName('tavily-search')).toBe(false);
    expect(isBuiltinToolName('')).toBe(false);
  });
});
