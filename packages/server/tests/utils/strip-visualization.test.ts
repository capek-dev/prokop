import { describe, test, expect } from 'bun:test';
import { stripVisualization, extractVisualization } from '@capekai/core/compat/jean2';

describe('stripVisualization', () => {
  test('returns null unchanged', () => {
    expect(stripVisualization(null)).toBe(null);
  });

  test('returns undefined unchanged', () => {
    expect(stripVisualization(undefined)).toBe(undefined);
  });

  test('returns primitives unchanged', () => {
    expect(stripVisualization('hello')).toBe('hello');
    expect(stripVisualization(42)).toBe(42);
    expect(stripVisualization(true)).toBe(true);
  });

  test('strips _visualization from flat object', () => {
    const input: Record<string, unknown> = {
      content: 'file contents',
      _visualization: { type: 'code', language: 'ts' },
    };
    const result = stripVisualization(input);
    expect(result).toEqual({ content: 'file contents' });
    expect('_visualization' in (result as object)).toBe(false);
  });

  test('strips _visualization from nested objects', () => {
    const input: Record<string, unknown> = {
      tools: [
        { name: 'read', _visualization: { type: 'list' } },
        { name: 'write', _visualization: { type: 'list' } },
      ],
    };
    const result = stripVisualization(input);
    expect(result).toEqual({
      tools: [{ name: 'read' }, { name: 'write' }],
    });
  });

  test('strips _visualization from arrays', () => {
    const input: Record<string, unknown>[] = [
      { _visualization: { type: 'diff' }, content: 'a' },
      { _visualization: { type: 'diff' }, content: 'b' },
    ];
    const result = stripVisualization(input);
    expect(result).toEqual([{ content: 'a' }, { content: 'b' }]);
  });

  test('preserves all other fields', () => {
    const input: Record<string, unknown> = { success: true, result: { files: ['a.ts'] }, _visualization: {} };
    const result = stripVisualization(input);
    expect(result).toEqual({ success: true, result: { files: ['a.ts'] } });
  });

  test('strips deeply nested _visualization', () => {
    const input: Record<string, unknown> = {
      level1: {
        level2: {
          _visualization: { type: 'deep' },
          value: 'kept',
        },
      },
    };
    const result = stripVisualization(input);
    expect(result).toEqual({
      level1: { level2: { value: 'kept' } },
    });
  });
});

describe('extractVisualization', () => {
  test('extracts _visualization from object', () => {
    const input = { content: 'hello', _visualization: { type: 'code', path: 'a.ts', content: 'x', language: 'ts', created: 0 } };
    const result = extractVisualization(input);
    expect(result).toBeDefined();
    expect(result!.type).toBe('code');
  });

  test('returns undefined when no _visualization', () => {
    expect(extractVisualization({ content: 'hello' })).toBeUndefined();
  });

  test('returns undefined for null', () => {
    expect(extractVisualization(null)).toBeUndefined();
  });

  test('returns undefined for string', () => {
    expect(extractVisualization('string')).toBeUndefined();
  });
});
