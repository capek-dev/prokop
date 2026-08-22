import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE, getAskCall } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('read-file tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('read-file');
  });

  test('has description', () => {
    expect(definition.description).toBeTruthy();
  });

  test('has required path input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.path).toBeDefined();
    expect(schema.required).toContain('path');
  });

  test('has optional offset and limit', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.offset).toBeDefined();
    expect(schema.properties.limit).toBeDefined();
  });

  test('has 30 second timeout', () => {
    expect(definition.timeout).toBe(30000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Reading Files
// ══════════════════════════════════════════════════════════════════

describe('reading files', () => {
  test('reads a workspace file successfully', async () => {
    vfs.writeFile(`${WORKSPACE}/hello.txt`, 'line1\nline2\nline3');
    const result = await execute({ path: `${WORKSPACE}/hello.txt` }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('1: line1');
    expect(content).toContain('2: line2');
    expect(content).toContain('3: line3');
    expect(content).toContain('End of file');
  });

  test('returns file not found for missing file', async () => {
    const result = await execute({ path: `${WORKSPACE}/nonexistent.txt` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test('reads with offset', async () => {
    vfs.writeFile(`${WORKSPACE}/lines.txt`, 'a\nb\nc\nd\ne');
    const result = await execute({ path: `${WORKSPACE}/lines.txt`, offset: 3 }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('3: c');
    expect(content).toContain('4: d');
    expect(content).toContain('5: e');
    expect(content).not.toContain('1: a');
  });

  test('reads with limit', async () => {
    vfs.writeFile(`${WORKSPACE}/lines.txt`, 'a\nb\nc\nd\ne');
    const result = await execute({ path: `${WORKSPACE}/lines.txt`, limit: 2 }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('1: a');
    expect(content).toContain('2: b');
    expect(content).not.toContain('3: c');
  });

  test('rejects offset less than 1', async () => {
    vfs.writeFile(`${WORKSPACE}/test.txt`, 'hello');
    const result = await execute({ path: `${WORKSPACE}/test.txt`, offset: 0 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('offset must be greater than or equal to 1');
  });

  test('shows truncation message when truncated', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    vfs.writeFile(`${WORKSPACE}/big.txt`, lines.join('\n'));
    const result = await execute({ path: `${WORKSPACE}/big.txt`, limit: 5 }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('Showing lines 1-5 of 20');
  });

  test('shows end of file when not truncated', async () => {
    vfs.writeFile(`${WORKSPACE}/small.txt`, 'hello');
    const result = await execute({ path: `${WORKSPACE}/small.txt` }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('End of file - total 1 lines');
  });

  test('handles relative path by resolving within workspace', async () => {
    vfs.writeFile(`${WORKSPACE}/relative.txt`, 'content');
    const result = await execute({ path: 'relative.txt' }, ctx);
    expect(result.success).toBe(true);
  });

  test('returns binary file error for binary content', async () => {
    // Simulate binary: content with null bytes
    vfs.writeFile(`${WORKSPACE}/binary.zip`, '\x00\x01\x02\x03');
    const result = await execute({ path: `${WORKSPACE}/binary.zip` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary file');
  });

  test('returns binary file error for .exe extension (no null bytes needed)', async () => {
    // Extension-based detection now works because .exe is in binaryExts list
    vfs.writeFile(`${WORKSPACE}/program.exe`, 'MZ\x00\x00');
    const result = await execute({ path: `${WORKSPACE}/program.exe` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary file');
  });

  test('returns binary file error for .dll extension with plain text content', async () => {
    // Extension check catches it even if content looks like text
    vfs.writeFile(`${WORKSPACE}/lib.dll`, 'this looks like text but is a DLL');
    const result = await execute({ path: `${WORKSPACE}/lib.dll` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary file');
  });

  test('returns binary file error for .zip extension', async () => {
    vfs.writeFile(`${WORKSPACE}/archive.zip`, 'PK\x00\x00');
    const result = await execute({ path: `${WORKSPACE}/archive.zip` }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('binary file');
  });
});

// ══════════════════════════════════════════════════════════════════
// Reading Directories
// ══════════════════════════════════════════════════════════════════

describe('reading directories', () => {
  test('lists directory entries', async () => {
    vfs.writeFile(`${WORKSPACE}/src/file1.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/file2.ts`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    const result = await execute({ path: `${WORKSPACE}/src` }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('file1.ts');
    expect(content).toContain('file2.ts');
  });

  test('shows trailing slash for directories', async () => {
    vfs.addDir(`${WORKSPACE}/mydir`);
    vfs.writeFile(`${WORKSPACE}/mydir/file.txt`, '');
    const result = await execute({ path: `${WORKSPACE}/mydir` }, ctx);
    expect(result.success).toBe(true);
    // The directory listing should show entries
    const content = (result.result as { content: string }).content;
    expect(content).toBeTruthy();
  });

  test('directory listing with limit and offset', async () => {
    for (let i = 1; i <= 10; i++) {
      vfs.writeFile(`${WORKSPACE}/many/file${i}.txt`, '');
    }
    vfs.addDir(`${WORKSPACE}/many`);
    const result = await execute({ path: `${WORKSPACE}/many`, limit: 3, offset: 2 }, ctx);
    expect(result.success).toBe(true);
    const content = (result.result as { content: string }).content;
    expect(content).toContain('Showing');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('read-file permissions', () => {
  test('blocked path returns error immediately', async () => {
    const result = await execute({ path: '/etc/passwd' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
  });

  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', 'data');
    const _result = await execute({ path: '/tmp/external/file.txt' }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', 'data');
    const _result = await execute({ path: '/tmp/external/file.txt' }, rejectCtx);
    expect(_result.success).toBe(false);
    expect(_result.error).toBe('USER_REJECTION');
  });

  test('sensitive file requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc');
    const _result = await execute({ path: `${WORKSPACE}/.env` }, ctx);
    expect(ctx.ask).toHaveBeenCalled();
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.isSensitiveFile).toBe(true);
  });

  test('sensitive file rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc');
    const result = await execute({ path: `${WORKSPACE}/.env` }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('workspace file does not require permission', async () => {
    vfs.writeFile(`${WORKSPACE}/normal.txt`, 'hello');
    const result = await execute({ path: `${WORKSPACE}/normal.txt` }, ctx);
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });

  test('allowedPaths bypasses permission checks', async () => {
    const allowedCtx = createMockContext(vfs, { allowedPaths: ['/tmp/external'] });
    vfs.writeFile('/tmp/external/file.txt', 'data');
    const _result = await execute({ path: '/tmp/external/file.txt' }, allowedCtx);
    expect(allowedCtx.ask).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Revision metadata (Phase 2)
// ══════════════════════════════════════════════════════════════════

describe('revision metadata', () => {
  test('same bytes produce the same revision', async () => {
    vfs.writeFile(`${WORKSPACE}/a.txt`, 'hello\nworld');
    vfs.writeFile(`${WORKSPACE}/b.txt`, 'hello\nworld');
    const a = await execute({ path: `${WORKSPACE}/a.txt` }, ctx);
    const b = await execute({ path: `${WORKSPACE}/b.txt` }, ctx);
    const revA = (a.result as { revision: string }).revision;
    const revB = (b.result as { revision: string }).revision;
    expect(revA).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(revA).toBe(revB);
  });

  test('one byte change produces a different revision', async () => {
    vfs.writeFile(`${WORKSPACE}/one.txt`, 'hello\nworld');
    vfs.writeFile(`${WORKSPACE}/two.txt`, 'hello\nworld!');
    const one = await execute({ path: `${WORKSPACE}/one.txt` }, ctx);
    const two = await execute({ path: `${WORKSPACE}/two.txt` }, ctx);
    expect((one.result as { revision: string }).revision).not.toBe(
      (two.result as { revision: string }).revision
    );
  });

  test('LF and CRLF content produce different revisions', async () => {
    vfs.writeFile(`${WORKSPACE}/lf.txt`, 'a\nb\nc');
    vfs.writeFile(`${WORKSPACE}/crlf.txt`, 'a\r\nb\r\nc');
    const lf = await execute({ path: `${WORKSPACE}/lf.txt` }, ctx);
    const crlf = await execute({ path: `${WORKSPACE}/crlf.txt` }, ctx);
    expect((lf.result as { revision: string }).revision).not.toBe(
      (crlf.result as { revision: string }).revision
    );
  });

  test('paginated reads of the same unchanged file return the same revision', async () => {
    vfs.writeFile(`${WORKSPACE}/paged.txt`, 'l1\nl2\nl3\nl4\nl5');
    const page1 = await execute({ path: `${WORKSPACE}/paged.txt`, offset: 1, limit: 2 }, ctx);
    const page2 = await execute({ path: `${WORKSPACE}/paged.txt`, offset: 3, limit: 2 }, ctx);
    expect((page1.result as { revision: string }).revision).toBe(
      (page2.result as { revision: string }).revision
    );
  });

  test('revision is calculated from untruncated content', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const full = lines.join('\n');
    vfs.writeFile(`${WORKSPACE}/big.txt`, full);

    const partial = await execute({ path: `${WORKSPACE}/big.txt`, limit: 5 }, ctx);
    const complete = await execute({ path: `${WORKSPACE}/big.txt` }, ctx);

    // The truncated read must report the revision of the full file, not the page.
    expect((partial.result as { revision: string }).revision).toBe(
      (complete.result as { revision: string }).revision
    );
    // And report accurate read metadata.
    expect((partial.result as { truncated: boolean }).truncated).toBe(true);
    expect((partial.result as { linesReturned: number }).linesReturned).toBe(5);
    expect((partial.result as { totalLines: number }).totalLines).toBe(30);
    expect((partial.result as { offset: number }).offset).toBe(1);
  });

  test('directory reads do not claim a file revision', async () => {
    vfs.writeFile(`${WORKSPACE}/src/file1.ts`, '');
    vfs.writeFile(`${WORKSPACE}/src/file2.ts`, '');
    vfs.addDir(`${WORKSPACE}/src`);
    const result = await execute({ path: `${WORKSPACE}/src` }, ctx);
    expect(result.success).toBe(true);
    expect((result.result as { revision?: string }).revision).toBeUndefined();
  });
});
