import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

function read(path: string): string {
  return vfs.readFile(path) ?? '';
}

function failCode(result: { result?: unknown }): string {
  return (result.result as { code?: string }).code ?? '';
}

function editIndex(result: { result?: unknown }): number | undefined {
  return (result.result as { editIndex?: number }).editIndex;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

describe('multiedit tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('multiedit');
  });

  test('has required path and edits inputs', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('path');
    expect(schema.required).toContain('edits');
  });
});

// ---------------------------------------------------------------------------
// Single edit
// ---------------------------------------------------------------------------

describe('multiedit: single edit', () => {
  test('applies a single edit and produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;\nconst y = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [{ oldString: 'const x = 1;', newString: 'const x = 3;' }],
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const x = 3;\nconst y = 2;');
  });
});

// ---------------------------------------------------------------------------
// Multiple edits (sequential application)
// ---------------------------------------------------------------------------

describe('multiedit: multiple edits', () => {
  test('applies multiple edits sequentially and produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;\nconst y = 2;\nconst z = 3;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'const x = 1;', newString: 'const x = 10;' },
        { oldString: 'const y = 2;', newString: 'const y = 20;' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const x = 10;\nconst y = 20;\nconst z = 3;');
  });

  test('returns one result per edit', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'aaa\nbbb');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'aaa', newString: 'ccc' },
        { oldString: 'bbb', newString: 'ddd' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { results: Array<{ matchInfo: { mode: string } }> };
    expect(res.results.length).toBe(2);
  });

  test('edits are applied in order (earlier edits affect later text)', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'old value');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'old', newString: 'new' },
        { oldString: 'new value', newString: 'replaced completely' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('replaced completely');
  });

  test('multi-line exact edit within a batch produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function foo() {\n  return 1;\n}\nconst bar = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'function foo() {\n  return 1;\n}', newString: 'function baz() {\n  return 9;\n}' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('function baz() {\n  return 9;\n}\nconst bar = 2;');
  });
});

// ---------------------------------------------------------------------------
// Atomicity and failing edit index
// ---------------------------------------------------------------------------

describe('multiedit: atomicity and failure modes', () => {
  test('remains atomic when a later edit fails (file unchanged)', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'hello', newString: 'world' },
        { oldString: 'nonexistent', newString: 'xyz' },
      ],
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('hello');
  });

  test('reports the zero-based failing edit index on no match', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'hello', newString: 'world' },
        { oldString: 'nonexistent', newString: 'xyz' },
      ],
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('NO_MATCH');
    expect(editIndex(result)).toBe(1);
  });

  test('reports the failing edit index on ambiguous match', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'foo\nbar\nfoo\nbaz');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'bar', newString: 'qux' },
        { oldString: 'foo', newString: 'zot' },
      ],
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
    expect(editIndex(result)).toBe(1);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('foo\nbar\nfoo\nbaz');
  });

  test('fails for non-existent file', async () => {
    const result = await execute({
      path: `${WORKSPACE}/nonexistent.ts`,
      edits: [{ oldString: 'a', newString: 'b' }],
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('multiedit: input validation', () => {
  test('empty edits array is rejected with INVALID_INPUT', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [],
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
    expect(read(`${WORKSPACE}/test.ts`)).toBe('hello');
  });

  test('empty oldString in an edit is rejected with INVALID_INPUT and editIndex', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [{ oldString: '', newString: 'world' }],
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
    expect(editIndex(result)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('multiedit: permissions', () => {
  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const _result = await execute({
      path: '/tmp/external/file.txt',
      edits: [{ oldString: 'hello', newString: 'world' }],
    }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION and keeps content', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const result = await execute({
      path: '/tmp/external/file.txt',
      edits: [{ oldString: 'hello', newString: 'world' }],
    }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(vfs.readFile('/tmp/external/file.txt')).toBe('hello');
  });

  test('sensitive file requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc');
    const _result = await execute({
      path: `${WORKSPACE}/.env`,
      edits: [{ oldString: 'SECRET=abc', newString: 'SECRET=xyz' }],
    }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('more than 10 edits requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'line\n'.repeat(15));
    const edits = Array.from({ length: 11 }, () => ({ oldString: 'line', newString: 'edited' }));
    const result = await execute({ path: `${WORKSPACE}/test.ts`, edits }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  test('workspace file with <=10 edits does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'aaa\nbbb');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [
        { oldString: 'aaa', newString: 'ccc' },
        { oldString: 'bbb', newString: 'ddd' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('returns diffs visualization on success', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'old line');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      edits: [{ oldString: 'old line', newString: 'new line' }],
    }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('diffs');
  });
});
