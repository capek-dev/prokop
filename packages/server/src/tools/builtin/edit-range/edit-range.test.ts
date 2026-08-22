import { createHash } from 'node:crypto';
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE, getAskCall } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

function computeRevision(content: string): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

function revisionOf(path: string): string {
  return computeRevision(vfs.readFile(path)!);
}

interface RangeResult {
  path: string;
  previousRevision: string;
  revision: string;
  editsApplied: number;
  ranges: Array<{ startLine: number; endLine: number }>;
}

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('edit-range tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('edit-range');
  });

  test('has description with example', () => {
    expect(definition.description).toContain('edit-range');
    expect(definition.description).toContain('startLine');
    expect(definition.description).toContain('sha256:abc123');
  });

  test('requires path, revision, edits', () => {
    const schema = definition.inputSchema as { required: string[] };
    expect(schema.required).toEqual(['path', 'revision', 'edits']);
  });

  test('edits array requires minItems 1', () => {
    const schema = definition.inputSchema as { properties: Record<string, { minItems?: number }> };
    expect(schema.properties.edits.minItems).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════
// Successful edits
// ══════════════════════════════════════════════════════════════════

describe('successful range edits', () => {
  test('replace one line', async () => {
    const p = `${WORKSPACE}/one.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: 'B' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nB\nc');
  });

  test('replace several adjacent lines', async () => {
    const p = `${WORKSPACE}/adj.txt`;
    vfs.writeFile(p, 'a\nb\nc\nd\ne');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 4, newString: 'X\nY' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nX\nY\ne');
  });

  test('delete a range with empty newString', async () => {
    const p = `${WORKSPACE}/del.txt`;
    vfs.writeFile(p, 'a\nb\nc\nd');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 3, newString: '' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nd');
  });

  test('apply multiple non-overlapping ranges', async () => {
    const p = `${WORKSPACE}/multi.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5\n6\n7');
    const result = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 1, endLine: 1, newString: 'ONE' },
          { startLine: 4, endLine: 4, newString: 'FOUR' },
          { startLine: 7, endLine: 7, newString: 'SEVEN' },
        ],
      },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('ONE\n2\n3\nFOUR\n5\n6\nSEVEN');
  });

  test('apply ranges correctly regardless of input order', async () => {
    const p = `${WORKSPACE}/order.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5\n6\n7');
    const resultReverse = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 7, endLine: 7, newString: 'SEVEN' },
          { startLine: 1, endLine: 1, newString: 'ONE' },
          { startLine: 4, endLine: 4, newString: 'FOUR' },
        ],
      },
      ctx
    );
    expect(resultReverse.success).toBe(true);
    expect(vfs.readFile(p)).toBe('ONE\n2\n3\nFOUR\n5\n6\nSEVEN');
  });

  test('return a revision matching the written content', async () => {
    const p = `${WORKSPACE}/rev.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: 'B' }] },
      ctx
    );
    expect(result.success).toBe(true);
    const res = result.result as RangeResult;
    expect(res.revision).toBe(computeRevision('a\nB\nc'));
    expect(res.previousRevision).toBe(computeRevision('a\nb\nc'));
    expect(res.editsApplied).toBe(1);
    expect(res.ranges).toEqual([{ startLine: 2, endLine: 2 }]);
  });
});

// ══════════════════════════════════════════════════════════════════
// Line-ending and trailing newline preservation
// ══════════════════════════════════════════════════════════════════

describe('line ending preservation', () => {
  test('preserve LF line endings', async () => {
    const p = `${WORKSPACE}/lf.txt`;
    vfs.writeFile(p, 'a\nb\nc\nd');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 3, newString: 'X\nY' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nX\nY\nd');
  });

  test('preserve CRLF line endings', async () => {
    const p = `${WORKSPACE}/crlf.txt`;
    vfs.writeFile(p, 'a\r\nb\r\nc\r\nd');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 3, newString: 'X\nY' }] },
      ctx
    );
    expect(result.success).toBe(true);
    // newString LF separators are normalized to the dominant CRLF ending
    expect(vfs.readFile(p)).toBe('a\r\nX\r\nY\r\nd');
  });

  test('preserve a missing final newline (range before last line)', async () => {
    const p = `${WORKSPACE}/nonewline.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 1, endLine: 1, newString: 'A' }] },
      ctx
    );
    expect(result.success).toBe(true);
    // No trailing newline is introduced
    expect(vfs.readFile(p)).toBe('A\nb\nc');
    expect(vfs.readFile(p)!.endsWith('\n')).toBe(false);
  });

  test('handle replacement of the final line (no trailing newline)', async () => {
    const p = `${WORKSPACE}/last.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 3, newString: 'C' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nb\nC');
  });

  test('replacement of final line can add a trailing newline', async () => {
    const p = `${WORKSPACE}/lastnl.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 3, newString: 'C\n' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nb\nC\n');
  });

  test('preserve original trailing newline when editing a non-final line', async () => {
    const p = `${WORKSPACE}/trailnl.txt`;
    vfs.writeFile(p, 'a\nb\nc\n');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: 'B' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nB\nc\n');
  });

  test('final line replacement preserves an existing trailing newline', async () => {
    const p = `${WORKSPACE}/finalnl.txt`;
    vfs.writeFile(p, 'a\nb\nc\n');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 3, newString: 'C' }] },
      ctx
    );
    expect(result.success).toBe(true);
    // The original trailing newline on line 3 is preserved as-is.
    expect(vfs.readFile(p)).toBe('a\nb\nC\n');
  });

  test('delete from a file with a trailing newline does not remove it', async () => {
    const p = `${WORKSPACE}/deltrail.txt`;
    vfs.writeFile(p, 'a\nb\nc\n');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: '' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nc\n');
  });
});

// ══════════════════════════════════════════════════════════════════
// CRLF replacement semantics
// ══════════════════════════════════════════════════════════════════

describe('CRLF replacement semantics', () => {
  test('delete a non-final CRLF line leaves no empty line', async () => {
    const p = `${WORKSPACE}/crlfdel.txt`;
    vfs.writeFile(p, 'a\r\nb\r\nc\r\nd');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: '' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\r\nc\r\nd');
  });

  test('replace a non-final CRLF line normalizes LF separators to CRLF', async () => {
    const p = `${WORKSPACE}/crlfrep.txt`;
    vfs.writeFile(p, 'a\r\nb\r\nc\r\nd');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 2, newString: 'B\nB2' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\r\nB\r\nB2\r\nc\r\nd');
  });

  test('delete a multi-line CRLF range leaves no empty line', async () => {
    const p = `${WORKSPACE}/crlfmultidel.txt`;
    vfs.writeFile(p, 'a\r\nb\r\nc\r\nd\r\ne');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 3, newString: '' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\r\nd\r\ne');
  });

  test('final line with no trailing newline is preserved (CRLF)', async () => {
    const p = `${WORKSPACE}/crlfnofinal.txt`;
    vfs.writeFile(p, 'a\r\nb\r\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 3, newString: 'C' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\r\nb\r\nC');
    expect(vfs.readFile(p)!.endsWith('\n')).toBe(false);
  });

  test('delete the final line removes its content and terminator', async () => {
    const p = `${WORKSPACE}/delfinal.txt`;
    vfs.writeFile(p, 'a\nb\nc\n');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 3, newString: '' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('a\nb\n');
  });
});

// ══════════════════════════════════════════════════════════════════
// Adjacent non-overlapping ranges and empty files
// ══════════════════════════════════════════════════════════════════

describe('adjacent ranges and empty files', () => {
  test('apply adjacent non-overlapping ranges touching end-to-end', async () => {
    const p = `${WORKSPACE}/adjacent.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5');
    const result = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 1, endLine: 1, newString: 'A' },
          { startLine: 2, endLine: 3, newString: 'B\nC' },
          { startLine: 4, endLine: 5, newString: 'D\nE' },
        ],
      },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('A\nB\nC\nD\nE');
  });

  test('edit an empty file treats line 1 as the final line', async () => {
    const p = `${WORKSPACE}/empty.txt`;
    vfs.writeFile(p, '');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 1, endLine: 1, newString: 'hello\nworld' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('hello\nworld');
  });

  test('edit the only line of a single-line file', async () => {
    const p = `${WORKSPACE}/single.txt`;
    vfs.writeFile(p, 'only line');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 1, endLine: 1, newString: 'replaced' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(vfs.readFile(p)).toBe('replaced');
  });
});

describe('validation failures leave file unchanged', () => {
  test('reject stale revision without writing', async () => {
    const p = `${WORKSPACE}/stale.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      {
        path: p,
        revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        edits: [{ startLine: 1, endLine: 1, newString: 'Z' }],
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('changed since it was read');
    expect((result.result as { code: string }).code).toBe('STALE_REVISION');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject overlap without writing', async () => {
    const p = `${WORKSPACE}/overlap.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5');
    const original = vfs.readFile(p);
    const result = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 1, endLine: 3, newString: 'X' },
          { startLine: 2, endLine: 4, newString: 'Y' },
        ],
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('overlap');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject duplicate (identical) ranges as overlapping', async () => {
    const p = `${WORKSPACE}/dup.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5');
    const original = vfs.readFile(p);
    const result = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 2, endLine: 3, newString: 'X' },
          { startLine: 2, endLine: 3, newString: 'Y' },
        ],
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('overlap');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject out-of-range lines without writing', async () => {
    const p = `${WORKSPACE}/oor.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 2, endLine: 99, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject endLine < startLine', async () => {
    const p = `${WORKSPACE}/inv.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 3, endLine: 1, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('must be >=');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject non-integer line numbers', async () => {
    const p = `${WORKSPACE}/float.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 1.5, endLine: 2, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('integer');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject startLine < 1', async () => {
    const p = `${WORKSPACE}/zero.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 0, endLine: 1, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('>= 1');
  });

  test('reject empty edits array', async () => {
    const p = `${WORKSPACE}/empty.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('at least one item');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject malformed revision format', async () => {
    const p = `${WORKSPACE}/badrev.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const original = vfs.readFile(p);
    const result = await execute(
      { path: p, revision: 'not-a-revision', edits: [{ startLine: 1, endLine: 1, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid revision');
    expect(vfs.readFile(p)).toBe(original);
  });

  test('reject missing file', async () => {
    const result = await execute(
      {
        path: `${WORKSPACE}/missing.txt`,
        revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        edits: [{ startLine: 1, endLine: 1, newString: 'Z' }],
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect((result.result as { code: string }).code).toBe('FILE_NOT_FOUND');
  });
});

// ══════════════════════════════════════════════════════════════════
// Permissions
// ══════════════════════════════════════════════════════════════════

describe('edit-range permissions', () => {
  test('blocked path returns error immediately', async () => {
    const result = await execute(
      {
        path: '/etc/passwd',
        revision: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        edits: [{ startLine: 1, endLine: 1, newString: 'Z' }],
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('system directories');
    expect((result.result as { code: string }).code).toBe('INVALID_INPUT');
  });

  test('outside workspace requires permission', async () => {
    vfs.writeFile('/tmp/external/file.txt', 'a\nb\nc');
    const _result = await execute(
      {
        path: '/tmp/external/file.txt',
        revision: revisionOf('/tmp/external/file.txt'),
        edits: [{ startLine: 1, endLine: 1, newString: 'Z' }],
      },
      ctx
    );
    expect(ctx.ask).toHaveBeenCalled();
  });

  test('outside workspace rejected returns USER_REJECTION', async () => {
    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });
    vfs.writeFile('/tmp/external/file.txt', 'a\nb\nc');
    const result = await execute(
      {
        path: '/tmp/external/file.txt',
        revision: revisionOf('/tmp/external/file.txt'),
        edits: [{ startLine: 1, endLine: 1, newString: 'Z' }],
      },
      rejectCtx
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
  });

  test('sensitive file requires permission', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=abc\nLINE2=def');
    const _result = await execute(
      {
        path: `${WORKSPACE}/.env`,
        revision: revisionOf(`${WORKSPACE}/.env`),
        edits: [{ startLine: 1, endLine: 1, newString: 'SECRET=xyz' }],
      },
      ctx
    );
    expect(ctx.ask).toHaveBeenCalled();
    const permAsk = getAskCall(ctx);
    expect(permAsk.metadata?.isSensitiveFile).toBe(true);
  });

  test('workspace file does not require permission', async () => {
    const p = `${WORKSPACE}/normal.txt`;
    vfs.writeFile(p, 'a\nb\nc');
    const result = await execute(
      { path: p, revision: revisionOf(p), edits: [{ startLine: 1, endLine: 1, newString: 'Z' }] },
      ctx
    );
    expect(result.success).toBe(true);
    expect(ctx.ask).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════
// Diff visualization
// ══════════════════════════════════════════════════════════════════

describe('diff visualization', () => {
  test('return a combined diff visualization with one hunk per range', async () => {
    const p = `${WORKSPACE}/vis.txt`;
    vfs.writeFile(p, '1\n2\n3\n4\n5\n6\n7');
    const result = await execute(
      {
        path: p,
        revision: revisionOf(p),
        edits: [
          { startLine: 2, endLine: 3, newString: 'TWO\nTHREE' },
          { startLine: 6, endLine: 6, newString: 'SIX' },
        ],
      },
      ctx
    );
    expect(result.success).toBe(true);
    const viz = result.visualization as {
      type: string;
      hunks: Array<{ changes: Array<{ type: string; content: string }> }>;
      additions: number;
      deletions: number;
    };
    expect(viz.type).toBe('diff');
    // one hunk per range
    expect(viz.hunks.length).toBe(2);
    expect(viz.additions).toBe(3);
    expect(viz.deletions).toBe(3);
    const removedContents = viz.hunks
      .flatMap(h => h.changes)
      .filter(c => c.type === 'removed')
      .map(c => c.content);
    expect(removedContents).toEqual(['2', '3', '6']);
  });
});
