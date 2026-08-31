import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, getAskCall, VirtualFS, WORKSPACE } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('ls tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('ls');
  });

  test('has no required inputs', () => {
    const schema = definition.inputSchema as { required: string[] };
    expect(schema.required).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════
// Directory Listing
// ══════════════════════════════════════════════════════════════════

describe('ls: directory listing', () => {
  test('lists files in workspace root', async () => {
    vfs.writeFile(`${WORKSPACE}/file1.txt`, '');
    vfs.writeFile(`${WORKSPACE}/file2.txt`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.writeFile(`${WORKSPACE}/src/index.ts`, '');

    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('file1.txt');
    expect(content).toContain('file2.txt');
    expect(content).toContain('src/');
  });

  test('lists files in subdirectory', async () => {
    vfs.writeFile(`${WORKSPACE}/src/a.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/b.ts`, '');

    const result = await execute({ path: `${WORKSPACE}/src` }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('a.ts');
    expect(content).toContain('b.ts');
  });

  test('returns error for non-existent directory', async () => {
    const result = await execute({ path: `${WORKSPACE}/nonexistent` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  test('returns error when path is a file', async () => {
    vfs.writeFile(`${WORKSPACE}/file.txt`, 'hello');
    const result = await execute({ path: `${WORKSPACE}/file.txt` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not a directory');
  });

  test('hidden files are hidden by default', async () => {
    vfs.writeFile(`${WORKSPACE}/.hidden`, 'secret');
    vfs.writeFile(`${WORKSPACE}/visible.txt`, 'hello');

    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).not.toContain('.hidden');
    expect(content).toContain('visible.txt');
  });

  test('showHidden reveals hidden files', async () => {
    vfs.writeFile(`${WORKSPACE}/.hidden`, 'secret');

    const result = await execute({ showHidden: true }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('.hidden');
  });

  test('additional ignore patterns', async () => {
    vfs.writeFile(`${WORKSPACE}/logs/app.log`, '');
    vfs.writeFile(`${WORKSPACE}/src/app.ts`, '');
    vfs.addDir(`${WORKSPACE}/logs`);
    vfs.addDir(`${WORKSPACE}/src`);

    const result = await execute({ ignore: ['logs'] }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).not.toContain('logs/');
    expect(content).toContain('src/');
  });

  test('returns tree-formatted output', async () => {
    vfs.writeFile(`${WORKSPACE}/README.md`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    vfs.writeFile(`${WORKSPACE}/src/index.ts`, '');

    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('./');
    expect(content.includes('├──') || content.includes('└──')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('ls: permissions', () => {
  test('blocked path returns error before listing', async () => {
    const result = await execute({ path: '/etc/config' }, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
    expect(ctx.fs.stat).not.toHaveBeenCalled();
  });

  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', '');

    const result = await execute({ path: '/tmp/external' }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.ask).toHaveBeenCalledTimes(1);
    expect(getAskCall(ctx).metadata?.isOutsideWorkspace).toBe(true);
  });

  test('outside workspace rejection prevents listing', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', '');

    const result = await execute({ path: '/tmp/external' }, rejectCtx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(rejectCtx.fs.stat).not.toHaveBeenCalled();
  });

  test('sensitive directory requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.ssh/keys/id_ed25519.pub`, '');

    const result = await execute({ path: `${WORKSPACE}/.ssh/keys` }, ctx);

    expect(result.success).toBe(true);
    expect(ctx.ask).toHaveBeenCalledTimes(1);
    expect(getAskCall(ctx).metadata?.isSensitiveFile).toBe(true);
  });

  test('allowed external path does not require permission', async () => {
    const allowedCtx = createMockContext(vfs, { allowedPaths: ['/tmp/external'] });
    vfs.writeFile('/tmp/external/file.txt', '');

    const result = await execute({ path: '/tmp/external' }, allowedCtx);

    expect(result.success).toBe(true);
    expect(allowedCtx.ask).not.toHaveBeenCalled();
  });

  test('workspace directory does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/file.txt`, '');

    const result = await execute({}, ctx);

    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});

describe('ls: edge cases', () => {
  test('empty directory shows just the root', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('./');
  });

  test('uses workspace root when no path provided', async () => {
    vfs.writeFile(`${WORKSPACE}/test.txt`, '');
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('test.txt');
  });
});
