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

describe('write-file tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('write-file');
  });

  test('has required path and content inputs', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.path).toBeDefined();
    expect(schema.properties.content).toBeDefined();
    expect(schema.required).toContain('path');
    expect(schema.required).toContain('content');
  });

  test('has 30 second timeout', () => {
    expect(definition.timeout).toBe(30000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Writing Files
// ══════════════════════════════════════════════════════════════════

describe('writing files', () => {
  test('creates a new file in workspace', async () => {
    const result = await execute({ path: `${WORKSPACE}/new.txt`, content: 'hello world' }, ctx);
    expect(result.success).toBe(true);
    expect(vfs.readFile(`${WORKSPACE}/new.txt`)).toBe('hello world');
  });

  test('overwrites existing file', async () => {
    vfs.writeFile(`${WORKSPACE}/existing.txt`, 'old content');
    await execute({ path: `${WORKSPACE}/existing.txt`, content: 'new content' }, ctx);
    expect(vfs.readFile(`${WORKSPACE}/existing.txt`)).toBe('new content');
  });

  test('returns path and bytes in result', async () => {
    const result = await execute({ path: `${WORKSPACE}/test.txt`, content: 'abc' }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { path: string; bytes: number };
    expect(res.path).toBe(`${WORKSPACE}/test.txt`);
    expect(res.bytes).toBe(3);
  });

  test('returns code visualization', async () => {
    const result = await execute({ path: `${WORKSPACE}/app.ts`, content: 'const x = 1;' }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('code');
    const viz = result.visualization as { language: string; lineCount: number; created: boolean };
    expect(viz.language).toBe('typescript');
    expect(viz.lineCount).toBe(1);
    expect(viz.created).toBe(true);
  });

  test('detects file language from extension', async () => {
    const result = await execute({ path: `${WORKSPACE}/style.css`, content: 'body {}' }, ctx);
    const viz = result.visualization as { language: string };
    expect(viz.language).toBe('css');
  });

  test('created flag is false for existing files', async () => {
    vfs.writeFile(`${WORKSPACE}/exists.txt`, 'old');
    const result = await execute({ path: `${WORKSPACE}/exists.txt`, content: 'new' }, ctx);
    const viz = result.visualization as { created: boolean };
    expect(viz.created).toBe(false);
  });

  test('handles relative path', async () => {
    const result = await execute({ path: 'relative.txt', content: 'data' }, ctx);
    expect(result.success).toBe(true);
    expect(vfs.readFile(`${WORKSPACE}/relative.txt`)).toBe('data');
  });

  test('multiline content line count', async () => {
    const result = await execute({ path: `${WORKSPACE}/multi.txt`, content: 'a\nb\nc' }, ctx);
    const viz = result.visualization as { lineCount: number };
    expect(viz.lineCount).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('write-file permissions', () => {
  test('blocked path returns error immediately', async () => {
    const result = await execute({ path: '/etc/config', content: 'data' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('outside workspace requires permission', async () => {
    const _result = await execute({ path: '/tmp/external/file.txt', content: 'data' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    const result = await execute({ path: '/tmp/external/file.txt', content: 'data' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    // Nothing was written
    expect(vfs.readFile('/tmp/external/file.txt')).toBeUndefined();
  });

  test('sensitive file requires permission', async () => {
    const _result = await execute({ path: `${WORKSPACE}/.env`, content: 'SECRET=abc' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('sensitive file rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    const result = await execute({ path: `${WORKSPACE}/.env`, content: 'SECRET=abc' }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('workspace file does not require permission', async () => {
    const result = await execute({ path: `${WORKSPACE}/normal.txt`, content: 'hello' }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('outside workspace approved writes file', async () => {
    const result = await execute({ path: '/tmp/external/file.txt', content: 'data' }, ctx);
    expect(result.success).toBe(true);
    expect(vfs.readFile('/tmp/external/file.txt')).toBe('data');
  });
});
