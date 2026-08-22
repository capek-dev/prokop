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

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

describe('edit tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('edit');
  });

  test('has required path, oldString, newString', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('path');
    expect(schema.required).toContain('oldString');
    expect(schema.required).toContain('newString');
  });

  test('has optional strategy parameter', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.strategy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Exact matching
// ---------------------------------------------------------------------------

describe('edit: exact match', () => {
  test('exact one-line replacement produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;\nconst y = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const x = 1;',
      newString: 'const x = 3;',
      strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const x = 3;\nconst y = 2;');
  });

  test('exact multi-line replacement produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function foo() {\n  return 1;\n}\nconst bar = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'function foo() {\n  return 1;\n}',
      newString: 'function bar() {\n  return 2;\n}',
      strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('function bar() {\n  return 2;\n}\nconst bar = 2;');
  });

  test('exact multi-line deletion produces complete final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'a\nb\nc\nd');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'b\nc\n',
      newString: '',
      strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('a\nd');
  });

  test('exact match at the beginning of a file', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'header\nbody\nfooter');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'header',
      newString: 'HEADER',
      strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('HEADER\nbody\nfooter');
  });

  test('exact match at the end of a file', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'header\nbody\nfooter');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'footer',
      newString: 'FOOTER',
      strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('header\nbody\nFOOTER');
  });

  test('reports match mode and line number', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello world');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'hello', newString: 'hi', strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    const matchInfo = (result.result as { matchInfo: { mode: string; lineNumber: number } }).matchInfo;
    expect(matchInfo.mode).toBe('exact');
    expect(matchInfo.lineNumber).toBe(1);
  });

  test('multiple exact matches return AMBIGUOUS_MATCH and do not write', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'foo\nbar\nfoo');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'foo', newString: 'qux', strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
    expect(read(`${WORKSPACE}/test.ts`)).toBe('foo\nbar\nfoo');
  });

  test('no exact match returns NO_MATCH', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello world');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'not found', newString: 'replacement', strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('NO_MATCH');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('edit: input validation', () => {
  test('empty oldString is rejected with INVALID_INPUT before any write', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: '',
      newString: 'world',
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
    expect(read(`${WORKSPACE}/test.ts`)).toBe('hello');
  });

  test('unknown strategy is rejected with INVALID_INPUT', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'hello', newString: 'world',
      strategy: 'fuzzy' as 'exact',
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
  });

  test('empty newString is permitted for deletion', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'keep\ndelete\nkeep');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'delete\n', newString: '', strategy: 'exact',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('keep\nkeep');
  });
});

// ---------------------------------------------------------------------------
// Line-ending normalization
// ---------------------------------------------------------------------------

describe('edit: line ending normalization', () => {
  test('CRLF file matched by LF input without converting unrelated line endings', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const b = 2;\nconst c = 3;',
      newString: 'const b = 20;\nconst c = 30;',
    }, ctx);
    expect(result.success).toBe(true);
    // Unmatched CRLF line (a) must remain CRLF
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const a = 1;\r\nconst b = 20;\r\nconst c = 30;');
  });
});

// ---------------------------------------------------------------------------
// Trailing whitespace normalization
// ---------------------------------------------------------------------------

describe('edit: trailing whitespace normalization', () => {
  test('trailing whitespace normalization maps the complete source span', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;   \nconst y = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const x = 1;\nconst y = 2;',
      newString: 'const x = 10;\nconst y = 20;',
    }, ctx);
    expect(result.success).toBe(true);
    // The trailing whitespace on line 1 is part of the matched span and removed.
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const x = 10;\nconst y = 20;');
  });

  test('internal whitespace is not collapsed by trailing-whitespace pass', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const   x   =   1;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const x = 1;', newString: 'const x = 2;',
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const   x   =   1;');
  });
});

// ---------------------------------------------------------------------------
// Indentation normalization
// ---------------------------------------------------------------------------

describe('edit: indentation normalization', () => {
  test('consistent indentation shift succeeds and maps the full span', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function foo() {\n    const x = 1;\n    const y = 2;\n}');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: '  const x = 1;\n  const y = 2;',
      newString: '    const x = 10;\n    const y = 20;',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('function foo() {\n    const x = 10;\n    const y = 20;\n}');
  });

  test('different relative indentation fails', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function foo() {\n    const x = 1;\n    const y = 2;\n}');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: '  const x = 1;\n    const y = 2;',
      newString: '  const x = 10;\n    const y = 20;',
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('function foo() {\n    const x = 1;\n    const y = 2;\n}');
  });

  test('ambiguous candidates at the indentation pass fail (no tie-break)', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, '  item;\n  item;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'item;', newString: 'thing;',
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('  item;\n  item;');
  });
});

// ---------------------------------------------------------------------------
// Whitespace safety inside string literals
// ---------------------------------------------------------------------------

describe('edit: string literal safety', () => {
  test('a whitespace difference inside a string literal does not match', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const s = "hello   world";');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const s = "hello world";', newString: 'const s = "replaced";',
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const s = "hello   world";');
  });
});

// ---------------------------------------------------------------------------
// Ambiguity isolation: strict ambiguity blocks looser passes
// ---------------------------------------------------------------------------

describe('edit: ambiguity isolation', () => {
  test('ambiguity at exact pass prevents a looser pass from selecting a candidate', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'foo\nfoo');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'foo', newString: 'bar',
    }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
    expect(read(`${WORKSPACE}/test.ts`)).toBe('foo\nfoo');
  });
});

// ---------------------------------------------------------------------------
// Compatibility strategies
// ---------------------------------------------------------------------------

describe('edit: compatibility strategies', () => {
  test('line_start produces correct offsets and final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, '  const x = 1;\n  let y = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: '  const', newString: '    const', strategy: 'line_start',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('    const x = 1;\n  let y = 2;');
  });

  test('line_end produces correct offsets and final content', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;  \nconst y = 2;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: '1;  ', newString: '1;', strategy: 'line_end',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const x = 1;\nconst y = 2;');
  });

  test('partial maps to safe normalization passes, never arbitrary collapse', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const   x = 1;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const x = 1;', newString: 'const x = 2;', strategy: 'partial',
    }, ctx);
    expect(result.success).toBe(false);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('const   x = 1;');
  });

  test('multi_line maps to exact for a verbatim multi-line string', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function foo() {\n  return 1;\n}');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'function foo() {\n  return 1;\n}',
      newString: 'function bar() {\n  return 2;\n}',
      strategy: 'multi_line',
    }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/test.ts`)).toBe('function bar() {\n  return 2;\n}');
  });
});

// ---------------------------------------------------------------------------
// Auto-strategy (no explicit strategy)
// ---------------------------------------------------------------------------

describe('edit: auto-strategy', () => {
  test('omitting strategy succeeds with exact for a unique match', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello world');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'hello', newString: 'hi',
    }, ctx);
    expect(result.success).toBe(true);
    const matchInfo = (result.result as { matchInfo: { mode: string } }).matchInfo;
    expect(matchInfo.mode).toBe('exact');
    expect(read(`${WORKSPACE}/test.ts`)).toBe('hi world');
  });

  test('auto-strategy reports mode used', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`,
      oldString: 'const x = 1;', newString: 'const x = 2;',
    }, ctx);
    expect(result.success).toBe(true);
    const matchInfo = (result.result as { matchInfo: { mode: string } }).matchInfo;
    expect(matchInfo.mode).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('edit: error handling', () => {
  test('returns error for non-existent file', async () => {
    const result = await execute({
      path: `${WORKSPACE}/nonexistent.ts`, oldString: 'a', newString: 'b',
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  test('returns error for blocked path', async () => {
    vfs.writeFile('/etc/config', 'data');
    const result = await execute({
      path: '/etc/config', oldString: 'data', newString: 'other',
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('returns diff visualization on success', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'old line');
    const result = await execute({
      path: `${WORKSPACE}/test.ts`, oldString: 'old line', newString: 'new line',
    }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('diff');
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('edit: permissions', () => {
  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const _result = await execute({
      path: '/tmp/external/file.txt', oldString: 'hello', newString: 'world',
    }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION and keeps original content', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const result = await execute({
      path: '/tmp/external/file.txt', oldString: 'hello', newString: 'world',
    }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(vfs.readFile('/tmp/external/file.txt')).toBe('hello');
  });

  test('sensitive file requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc');
    const _result = await execute({
      path: `${WORKSPACE}/.env`, oldString: 'SECRET=abc', newString: 'SECRET=xyz',
    }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('workspace file does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/normal.txt`, 'hello');
    const result = await execute({
      path: `${WORKSPACE}/normal.txt`, oldString: 'hello', newString: 'world',
    }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});
