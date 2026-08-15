import { describe, expect, test } from 'bun:test';
import { getStandardTool, listStandardTools, STANDARD_TOOL_NAMES } from '../src/tools/standard-tools';

const EXPECTED_NAMES = [
  'read-file',
  'write-file',
  'edit',
  'edit-range',
  'apply-patch',
  'ls',
  'glob',
  'grep',
  'shell',
  'question',
  'retrieve-tool-output',
] as const;

const EXPECTED_TIMEOUTS: Record<string, number> = {
  'read-file': 30_000,
  'write-file': 30_000,
  edit: 30_000,
  'edit-range': 180_000,
  'apply-patch': 180_000,
  ls: 30_000,
  glob: 30_000,
  grep: 30_000,
  shell: 60_000,
  question: 300_000,
  'retrieve-tool-output': 30_000,
};

const BUILTIN_PATH = 'builtin:@capekai/core';

const CONDITIONALLY_COMPOSED_TOOL_NAMES = [
  'task',
  'memory',
  'skill',
  'skill_manage',
  'session_search',
  'scheduler',
  'workflow',
  'agent_memory',
  'agent_skill_manage',
  'retrieve-exact-tool-output',
];

describe('default standard tool inventory', () => {
  test('exposes the exact default set in insertion order with no extras', () => {
    expect(STANDARD_TOOL_NAMES).toEqual([...EXPECTED_NAMES]);
    expect(listStandardTools().map((entry) => entry.definition.name)).toEqual([...EXPECTED_NAMES]);
    for (const name of EXPECTED_NAMES) {
      expect(getStandardTool(name)?.definition.name).toBe(name);
    }
  });

  test('pins definition timeouts and capabilities per tool', () => {
    for (const name of EXPECTED_NAMES) {
      const loaded = getStandardTool(name);
      expect(loaded, name).not.toBeNull();
      expect(loaded!.definition.timeout, name).toBe(EXPECTED_TIMEOUTS[name]);
      if (name === 'question') {
        expect(loaded!.definition.capabilities, name).toEqual(['interactive-user-input']);
      } else {
        expect(loaded!.definition.capabilities, name).toBeUndefined();
      }
    }
  });

  test('marks every default tool as the builtin bundle with an executable', () => {
    for (const name of EXPECTED_NAMES) {
      const loaded = getStandardTool(name);
      expect(loaded!.path, name).toBe(BUILTIN_PATH);
      expect(typeof loaded!.execute, name).toBe('function');
      expect(loaded!.definition.inputSchema.type, name).toBe('object');
      expect(loaded!.definition.description.length, name).toBeGreaterThan(0);
    }
  });

  test('excludes conditionally composed tools from the default map', () => {
    for (const name of CONDITIONALLY_COMPOSED_TOOL_NAMES) {
      expect(getStandardTool(name), name).toBeNull();
    }
    const names = new Set(listStandardTools().map((entry) => entry.definition.name));
    for (const name of CONDITIONALLY_COMPOSED_TOOL_NAMES) {
      expect(names.has(name), name).toBe(false);
    }
  });
});
