import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('grep tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('grep');
  });

  test('has required pattern and path', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('pattern');
    expect(schema.required).toContain('path');
  });

  test('has optional include and ignore properties', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('include');
    expect(schema.properties).toHaveProperty('ignore');
  });
});

// ══════════════════════════════════════════════════════════════════
// Pattern Search
// ══════════════════════════════════════════════════════════════════

describe('grep: pattern search', () => {
  test('finds matching lines in a single file', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'const x = 1;\nconst y = 2;\nconsole.log(x);');

    const result = await execute({ pattern: 'const', path: `${WORKSPACE}/test.ts` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ line: number; content: string }> }).matches;
    expect(matches.length).toBe(2);
    expect(matches[0].line).toBe(1);
    expect(matches[0].content).toContain('const x = 1');
  });

  test('finds matches across files in directory', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, 'export const a = 1;');
    vfs.writeFile(`${WORKSPACE}/src/b.ts`, 'export const b = 2;');
    vfs.writeFile(`${WORKSPACE}/src/c.css`, '.class {}');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'export', path: `${WORKSPACE}/src` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(2);
  });

  test('supports regex patterns', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'function hello() {}\nconst x = 1;');

    const result = await execute({ pattern: 'function\\s+\\w+', path: `${WORKSPACE}/test.ts` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ content: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].content).toContain('function hello');
  });

  test('returns empty matches when pattern not found', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello world');

    const result = await execute({ pattern: 'xyz', path: `${WORKSPACE}/test.ts` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: unknown[] }).matches;
    expect(matches.length).toBe(0);
  });

  test('invalid regex returns error', async () => {
    vfs.writeFile(`${WORKSPACE}/test.ts`, 'hello');

    const result = await execute({ pattern: '[invalid', path: `${WORKSPACE}/test.ts` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid regex');
  });
});

// ══════════════════════════════════════════════════════════════════
// Include Filter (picomatch)
// ══════════════════════════════════════════════════════════════════

describe('grep: include filter', () => {
  test('basic wildcard *.ts filters by extension', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/b.js`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/c.css`, '.import {}');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, include: '*.ts' }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('a.ts');
  });

  test('brace expansion *.{ts,tsx} matches multiple extensions', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/b.tsx`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/c.css`, '.import {}');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, include: '*.{ts,tsx}' }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(2);
  });

  test('character class [abc]*.ts matches files starting with a, b, or c', async () => {
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/cli.ts`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/util.ts`, 'import baz');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, include: '[abc]*.ts' }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(2);
    const files = matches.map(m => m.file);
    expect(files.some(f => f.includes('app.ts'))).toBe(true);
    expect(files.some(f => f.includes('cli.ts'))).toBe(true);
  });

  test('extglob !(vite-env)* excludes vite-env files', async () => {
    vfs.writeFile(`${WORKSPACE}/src/vite-env.d.ts`, 'export default {}');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'export default app');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'export default', path: `${WORKSPACE}/src`, include: '!(vite-env)*' }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });

  test('globstar **/*.tsx matches in subdirectories', async () => {
    vfs.writeFile(`${WORKSPACE}/src/components/Header.tsx`, 'export default');
    vfs.writeFile(`${WORKSPACE}/src/util.ts`, 'export default');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.addDir(`${WORKSPACE}/src/components`);

    const result = await execute({ pattern: 'export default', path: `${WORKSPACE}/src`, include: '**/*.tsx' }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('Header.tsx');
  });
});

// ══════════════════════════════════════════════════════════════════
// Ignore Filter (picomatch)
// ══════════════════════════════════════════════════════════════════

describe('grep: ignore filter', () => {
  test('ignore excludes matching files', async () => {
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/app.test.ts`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/util.ts`, 'import baz');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, ignore: ['*.test.ts'] }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(2);
    const files = matches.map(m => m.file);
    expect(files.some(f => f.includes('app.test.ts'))).toBe(false);
  });

  test('ignore with globstar excludes subdirectories', async () => {
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/fixtures/mock.ts`, 'import bar');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.addDir(`${WORKSPACE}/src/fixtures`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, ignore: ['**/fixtures/**'] }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });

  test('ignore with brace expansion excludes multiple patterns', async () => {
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/app.test.ts`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/app.spec.ts`, 'import baz');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}/src`, ignore: ['*.test.ts', '*.spec.ts'] }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });

  test('include and ignore work together', async () => {
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/app.test.ts`, 'import bar');
    vfs.writeFile(`${WORKSPACE}/src/util.js`, 'import baz');
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({
      pattern: 'import',
      path: `${WORKSPACE}/src`,
      include: '*.ts',
      ignore: ['*.test.ts'],
    }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });
});

// ══════════════════════════════════════════════════════════════════
// SKIP_DIRS
// ══════════════════════════════════════════════════════════════════

describe('grep: skip directories', () => {
  test('skips node_modules', async () => {
    vfs.writeFile(`${WORKSPACE}/node_modules/pkg/index.js`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import bar');
    vfs.addDir(`${WORKSPACE}/node_modules`);
    vfs.addDir(`${WORKSPACE}/node_modules/pkg`);
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });

  test('skips dist directory', async () => {
    vfs.writeFile(`${WORKSPACE}/dist/bundle.js`, 'import foo');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import bar');
    vfs.addDir(`${WORKSPACE}/dist`);
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });

  test('skips .venv directory', async () => {
    vfs.writeFile(`${WORKSPACE}/.venv/lib/site.py`, 'import os');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, 'import bar');
    vfs.addDir(`${WORKSPACE}/.venv`);
    vfs.addDir(`${WORKSPACE}/.venv/lib`);
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ pattern: 'import', path: `${WORKSPACE}` }, ctx);
    expect(result.success).toBe(true);
    const matches = (result.result as { matches: Array<{ file: string }> }).matches;
    expect(matches.length).toBe(1);
    expect(matches[0].file).toContain('app.ts');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('grep: permissions', () => {
  test('blocked path returns error', async () => {
    const result = await execute({ pattern: 'test', path: '/etc/config' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const _result = await execute({ pattern: 'hello', path: '/tmp/external' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', 'hello');
    const result = await execute({ pattern: 'hello', path: '/tmp/external' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('sensitive path requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc');
    const _result = await execute({ pattern: 'SECRET', path: `${WORKSPACE}/.env` }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('workspace file does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/normal.txt`, 'hello');
    const result = await execute({ pattern: 'hello', path: `${WORKSPACE}/normal.txt` }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});
