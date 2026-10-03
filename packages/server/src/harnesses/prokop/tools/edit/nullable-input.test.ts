import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { ToolContext } from '@prokopai/sdk';
import { definition, execute } from './tool';

const original = 'one\ntwo\nthree\n';
const stringEdit = { oldString: 'one', newString: 'ONE', strategy: null, startLine: null, endLine: null };
const rangeEdit = { oldString: null, newString: 'TWO', strategy: null, startLine: 2, endLine: 2 };

function fixture() {
  let content = original;
  let writes = 0;
  const ctx = {
    workspacePath: '/workspace',
    resolvePath: () => '/workspace/file.txt',
    isBlockedPath: () => false,
    isWithinWorkspace: () => true,
    isSensitivePath: () => false,
    fs: {
      exists: async () => true,
      readFile: async () => content,
      writeFile: async (_path: string, value: string) => { content = value; writes++; },
    },
  } as unknown as ToolContext;
  return {
    run: (edits: unknown[], revision: unknown = null) => execute(
      { path: '/workspace/file.txt', edits, revision } as Parameters<typeof execute>[0], ctx,
    ),
    content: () => content,
    writes: () => writes,
  };
}

describe('edit nullable input contract', () => {
  test('schema permits null for every optional field while keeping replacement text required', () => {
    const schema = definition.inputSchema as {
      required: string[];
      properties: {
        revision: { type: string[] };
        edits: { items: { required: string[]; properties: Record<string, { type: string | string[]; enum?: unknown[] }> } };
      };
    };
    expect(schema.required).toEqual(['path', 'edits']);
    expect(schema.properties.revision.type).toContain('null');
    const item = schema.properties.edits.items;
    expect(item.required).toEqual(['newString']);
    for (const field of ['oldString', 'strategy', 'startLine', 'endLine']) {
      expect(item.properties[field].type).toContain('null');
    }
    expect(item.properties.strategy.enum).toContain(null);
    expect(item.properties.newString.type).toBe('string');
  });

  test('accepts all fields supplied with null placeholders, applying both modes sequentially', async () => {
    const f = fixture();
    expect((await f.run([stringEdit, rangeEdit])).success).toBe(true);
    expect(f.content()).toBe('ONE\nTWO\nthree\n');
    expect(f.writes()).toBe(1);
  });

  test('null strategy retains formatting-tolerant matching', async () => {
    const f = fixture();
    expect((await f.run([{ ...stringEdit, oldString: 'one\r\ntwo', newString: 'first two' }])).success).toBe(true);
    expect(f.content()).toBe('first two\nthree\n');
  });

  test.each([
    null,
    [],
    { ...stringEdit, startLine: 1, endLine: 1 },
    { ...stringEdit, endLine: 1 },
    { ...stringEdit, startLine: '1' },
    { ...rangeEdit, startLine: null },
    { ...rangeEdit, endLine: null },
    { ...rangeEdit, endLine: '2' },
    { ...rangeEdit, oldString: '' },
    { ...rangeEdit, oldString: 42 },
    { ...rangeEdit, strategy: 'exact' },
    { ...rangeEdit, startLine: 0 },
    { ...rangeEdit, startLine: 1.5 },
    { ...stringEdit, oldString: null },
    { ...stringEdit, strategy: 'unknown' },
    { ...stringEdit, newString: null },
  ])('rejects malformed or mixed edit %# without any write', async (edit) => {
    const f = fixture();
    const result = await f.run([stringEdit, edit]);
    expect(result.success).toBe(false);
    expect(result.result).toMatchObject({ code: 'INVALID_INPUT', editIndex: 1 });
    expect(f.content()).toBe(original);
    expect(f.writes()).toBe(0);
  });

  test('a later no-match edit still rolls back the whole batch', async () => {
    const f = fixture();
    const result = await f.run([rangeEdit, { ...stringEdit, oldString: 'absent' }]);
    expect(result.result).toMatchObject({ code: 'NO_MATCH', editIndex: 1 });
    expect(f.content()).toBe(original);
    expect(f.writes()).toBe(0);
  });

  test('nullable fields do not bypass a supplied revision', async () => {
    const f = fixture();
    const stale = `sha256:${'0'.repeat(64)}`;
    expect((await f.run([stringEdit], stale)).result).toMatchObject({ code: 'STALE_REVISION' });
    expect(f.writes()).toBe(0);
    const revision = `sha256:${createHash('sha256').update(original).digest('hex')}`;
    expect((await f.run([stringEdit], revision)).success).toBe(true);
    expect(f.writes()).toBe(1);
  });

  test.each(['', false, 123])('rejects invalid revision %p instead of treating it as omitted', async revision => {
    const f = fixture();
    expect((await f.run([stringEdit], revision)).result).toMatchObject({ code: 'INVALID_INPUT' });
    expect(f.writes()).toBe(0);
  });
});
