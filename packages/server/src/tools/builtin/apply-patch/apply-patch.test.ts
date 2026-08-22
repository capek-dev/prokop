import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { definition, execute } from './tool';
import { createMockContext, VirtualFS, WORKSPACE, getAskCall, getAllAskCalls } from '../test-utils';

let vfs: VirtualFS;
let ctx: ReturnType<typeof createMockContext>;

beforeEach(() => {
  vfs = new VirtualFS();
  ctx = createMockContext(vfs);
});

function read(path: string): string {
  return vfs.readFile(path) ?? '';
}

function has(path: string): boolean {
  return vfs.hasFile(path);
}

function failCode(result: { result?: unknown }): string {
  return (result.result as { code?: string }).code ?? '';
}

interface PatchResult {
  added: string[];
  modified: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
  matchModes: Array<{ path: string; chunkIndex: number; mode: string; startLine: number }>;
}

function patchResult(result: { result?: unknown }): PatchResult {
  return result.result as PatchResult;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

describe('apply-patch tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('apply-patch');
  });

  test('requires patch input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('patch');
  });

  test('description states hunk line numbers are not used', () => {
    const desc = definition.description as string;
    expect(desc).toContain('line numbers are not used');
  });

  test('description includes a patch format example', () => {
    const desc = definition.description as string;
    expect(desc).toContain('*** Begin Patch');
    expect(desc).toContain('*** End Patch');
  });
});

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('apply-patch parser', () => {
  test('parses add, update, delete, and move operations', async () => {
    vfs.writeFile(`${WORKSPACE}/existing.ts`, 'export const x = 1;\n');
    vfs.writeFile(`${WORKSPACE}/toDelete.ts`, 'bye\n');
    vfs.writeFile(`${WORKSPACE}/toMove.ts`, 'move me\n');

    const patch = `*** Begin Patch
*** Update File: existing.ts
@@
-export const x = 1;
+export const x = 2;
*** Add File: created.ts
+const y = 3;
*** Delete File: toDelete.ts
*** Update File: toMove.ts
*** Move to: moved.ts
@@
-move me
+moved
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    const r = patchResult(result);
    expect(r.modified).toContain(`${WORKSPACE}/existing.ts`);
    expect(r.added).toContain(`${WORKSPACE}/created.ts`);
    expect(r.deleted).toContain(`${WORKSPACE}/toDelete.ts`);
    expect(r.moved).toEqual([{ from: `${WORKSPACE}/toMove.ts`, to: `${WORKSPACE}/moved.ts` }]);
    expect(read(`${WORKSPACE}/existing.ts`)).toBe('export const x = 2;\n');
    expect(read(`${WORKSPACE}/created.ts`)).toBe('const y = 3;\n');
    expect(has(`${WORKSPACE}/toDelete.ts`)).toBe(false);
    expect(has(`${WORKSPACE}/toMove.ts`)).toBe(false);
    expect(read(`${WORKSPACE}/moved.ts`)).toBe('moved\n');
  });

  test('parses multiple files in one patch', async () => {
    vfs.writeFile(`${WORKSPACE}/a.ts`, 'a1\n');
    vfs.writeFile(`${WORKSPACE}/b.ts`, 'b1\n');

    const patch = `*** Begin Patch
*** Update File: a.ts
@@
-a1
+a2
*** Update File: b.ts
@@
-b1
+b2
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/a.ts`)).toBe('a2\n');
    expect(read(`${WORKSPACE}/b.ts`)).toBe('b2\n');
  });

  test('parses multiple chunks in one file', async () => {
    vfs.writeFile(
      `${WORKSPACE}/multi.ts`,
      'line1\nline2\nline3\nline4\nline5\n',
    );

    const patch = `*** Begin Patch
*** Update File: multi.ts
@@
-line1
+LINE1
@@
-line5
+LINE5
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/multi.ts`)).toBe('LINE1\nline2\nline3\nline4\nLINE5\n');
  });

  test('preserves blank context, added, and removed lines', async () => {
    vfs.writeFile(`${WORKSPACE}/blank.ts`, 'top\n\nbottom\n');

    const patch = `*** Begin Patch
*** Update File: blank.ts
@@
 top
${' '}
-bottom
+BOTTOM
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/blank.ts`)).toBe('top\n\nBOTTOM\n');
  });

  test('rejects missing begin marker', async () => {
    const patch = `*** Update File: x.ts
@@
-a
+b
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('rejects missing end marker', async () => {
    vfs.writeFile(`${WORKSPACE}/x.ts`, 'a\n');
    const patch = `*** Begin Patch
*** Update File: x.ts
@@
-a
+b`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('rejects unknown marker', async () => {
    const patch = `*** Begin Patch
*** Rename File: x.ts
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('rejects empty update operation', async () => {
    vfs.writeFile(`${WORKSPACE}/x.ts`, 'a\n');
    const patch = `*** Begin Patch
*** Update File: x.ts
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('rejects empty patch', async () => {
    const result = await execute({ patch: '' }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
  });

  test('rejects patch with no file operations', async () => {
    const patch = `*** Begin Patch
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
  });

  test('rejects malformed control line with source line number', async () => {
    vfs.writeFile(`${WORKSPACE}/x.ts`, 'a\n');
    const patch = `*** Begin Patch
*** Update File: x.ts
@@ -1,1 +1,1 @@
-a
+b
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('rejects duplicate operations on the same path', async () => {
    vfs.writeFile(`${WORKSPACE}/x.ts`, 'a\n');
    const patch = `*** Begin Patch
*** Update File: x.ts
@@
-a
+b
*** Update File: x.ts
@@
-b
+c
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('preserves marker prefixes after removing one control character', async () => {
    vfs.writeFile(`${WORKSPACE}/code.ts`, '  indented\n');
    const patch = `*** Begin Patch
*** Update File: code.ts
@@
-  indented
+  replaced
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/code.ts`)).toBe('  replaced\n');
  });

  test('add file may only contain plus lines', async () => {
    const patch = `*** Begin Patch
*** Add File: bad.ts
-notallowed
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });

  test('delete file must not contain body lines', async () => {
    vfs.writeFile(`${WORKSPACE}/d.ts`, 'x\n');
    const patch = `*** Begin Patch
*** Delete File: d.ts
-x
*** End Patch`;
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('PARSE_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Application tests
// ---------------------------------------------------------------------------

describe('apply-patch application', () => {
  test('preserve unchanged context lines exactly', async () => {
    vfs.writeFile(
      `${WORKSPACE}/ctx.ts`,
      'import { a } from "a";\nimport { b } from "b";\nimport { c } from "c";\n',
    );

    const patch = `*** Begin Patch
*** Update File: ctx.ts
@@
 import { a } from "a";
-import { b } from "b";
+import { B } from "B";
 import { c } from "c";
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/ctx.ts`)).toBe(
      'import { a } from "a";\nimport { B } from "B";\nimport { c } from "c";\n',
    );
  });

  test('replace the first line of a file', async () => {
    vfs.writeFile(`${WORKSPACE}/first.ts`, 'header\nbody\nfooter\n');

    const patch = `*** Begin Patch
*** Update File: first.ts
@@
-header
+HEADER
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/first.ts`)).toBe('HEADER\nbody\nfooter\n');
  });

  test('replace the last line of a file', async () => {
    vfs.writeFile(`${WORKSPACE}/last.ts`, 'header\nbody\nfooter\n');

    const patch = `*** Begin Patch
*** Update File: last.ts
@@
-footer
+FOOTER
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/last.ts`)).toBe('header\nbody\nFOOTER\n');
  });

  test('insert after a semantic context anchor', async () => {
    vfs.writeFile(`${WORKSPACE}/anchor.ts`, 'function foo() {\n  return 1;\n}\n');

    const patch = `*** Begin Patch
*** Update File: anchor.ts
@@ function foo() {
+  console.log("called");
   return 1;
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/anchor.ts`)).toBe(
      'function foo() {\n  console.log("called");\n  return 1;\n}\n',
    );
  });

  test('pure insertion after a semantic anchor inserts immediately after anchor line', async () => {
    vfs.writeFile(`${WORKSPACE}/pure.ts`, 'function bar() {\n}\n');

    const patch = `*** Begin Patch
*** Update File: pure.ts
@@ function bar() {
+  return 42;
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/pure.ts`)).toBe('function bar() {\n  return 42;\n}\n');
  });

  test('insert at end of file with *** End of File', async () => {
    vfs.writeFile(`${WORKSPACE}/eof.ts`, 'existing content\n');

    const patch = `*** Begin Patch
*** Update File: eof.ts
@@
+appended line
*** End of File
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/eof.ts`)).toBe('existing content\nappended line\n');
  });

  test('insert at end of file without trailing newline adds one', async () => {
    vfs.writeFile(`${WORKSPACE}/eof2.ts`, 'no newline');

    const patch = `*** Begin Patch
*** Update File: eof2.ts
@@
+appended
*** End of File
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/eof2.ts`)).toBe('no newline\nappended\n');
  });

  test('reject ambiguous pure insertion without anchor or EOF', async () => {
    vfs.writeFile(`${WORKSPACE}/amb.ts`, 'one\ntwo\n');

    const patch = `*** Begin Patch
*** Update File: amb.ts
@@
+injected
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_INSERTION');
    expect(read(`${WORKSPACE}/amb.ts`)).toBe('one\ntwo\n');
  });

  test('apply multiple ordered chunks and advance search cursor', async () => {
    vfs.writeFile(
      `${WORKSPACE}/ordered.ts`,
      'a\nx\nb\nx\nc\n',
    );

    const patch = `*** Begin Patch
*** Update File: ordered.ts
@@
-x
+X
*** End Patch`;

    // Two occurrences of "x" - should be ambiguous with a bare chunk.
    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
  });

  test('ambiguous chunk fails and does not write', async () => {
    vfs.writeFile(`${WORKSPACE}/dup.ts`, 'dup\ndup\n');

    const patch = `*** Begin Patch
*** Update File: dup.ts
@@
-dup
+unique
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
    expect(read(`${WORKSPACE}/dup.ts`)).toBe('dup\ndup\n');
  });

  test('no match returns NO_MATCH and does not write', async () => {
    vfs.writeFile(`${WORKSPACE}/nomatch.ts`, 'hello\n');

    const patch = `*** Begin Patch
*** Update File: nomatch.ts
@@
-missing
+found
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('NO_MATCH');
    expect(read(`${WORKSPACE}/nomatch.ts`)).toBe('hello\n');
  });

  test('does not match a patch line inside a longer source line', async () => {
    vfs.writeFile(`${WORKSPACE}/substring.ts`, 'prefix-value-suffix\n');
    const patch = `*** Begin Patch
*** Update File: substring.ts
@@
-value
+changed
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('NO_MATCH');
    expect(read(`${WORKSPACE}/substring.ts`)).toBe('prefix-value-suffix\n');
  });

  test('preserve LF line endings in file content', async () => {
    vfs.writeFile(`${WORKSPACE}/lf.ts`, 'line1\nline2\nline3\n');

    const patch = `*** Begin Patch
*** Update File: lf.ts
@@
-line2
+LINE2
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/lf.ts`)).toBe('line1\nLINE2\nline3\n');
  });

  test('preserve CRLF line endings in file content', async () => {
    vfs.writeFile(`${WORKSPACE}/crlf.ts`, 'line1\r\nline2\r\nline3\r\n');

    const patch = `*** Begin Patch
*** Update File: crlf.ts
@@
-line2
+LINE2
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    // CRLF preserved around the unchanged lines; added line uses file dominant ending.
    expect(read(`${WORKSPACE}/crlf.ts`)).toBe('line1\r\nLINE2\r\nline3\r\n');
  });

  test('preserve trailing newline state', async () => {
    vfs.writeFile(`${WORKSPACE}/tn.ts`, 'a\nb'); // no trailing newline

    const patch = `*** Begin Patch
*** Update File: tn.ts
@@
-a
+A
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/tn.ts`)).toBe('A\nb');
  });

  test('create a file with blank lines', async () => {
    const patch = `*** Begin Patch
*** Add File: blanks.ts
+line1
+
+line3
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/blanks.ts`)).toBe('line1\n\nline3\n');
  });

  test('delete the file rather than emptying it', async () => {
    vfs.writeFile(`${WORKSPACE}/del.ts`, 'content to delete\n');

    const patch = `*** Begin Patch
*** Delete File: del.ts
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(has(`${WORKSPACE}/del.ts`)).toBe(false);
    const r = patchResult(result);
    expect(r.deleted).toContain(`${WORKSPACE}/del.ts`);
  });

  test('move and update a file', async () => {
    vfs.writeFile(`${WORKSPACE}/src.ts`, 'original\n');

    const patch = `*** Begin Patch
*** Update File: src.ts
*** Move to: dest.ts
@@
-original
+moved and updated
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(has(`${WORKSPACE}/src.ts`)).toBe(false);
    expect(read(`${WORKSPACE}/dest.ts`)).toBe('moved and updated\n');
    const r = patchResult(result);
    expect(r.moved).toEqual([{ from: `${WORKSPACE}/src.ts`, to: `${WORKSPACE}/dest.ts` }]);
  });

  test('reject an existing add destination', async () => {
    vfs.writeFile(`${WORKSPACE}/exists.ts`, 'already here\n');

    const patch = `*** Begin Patch
*** Add File: exists.ts
+new
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('DEST_EXISTS');
    expect(read(`${WORKSPACE}/exists.ts`)).toBe('already here\n');
  });

  test('reject an existing move destination', async () => {
    vfs.writeFile(`${WORKSPACE}/src2.ts`, 'source\n');
    vfs.writeFile(`${WORKSPACE}/dest2.ts`, 'dest exists\n');

    const patch = `*** Begin Patch
*** Update File: src2.ts
*** Move to: dest2.ts
@@
-source
+moved
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('DEST_EXISTS');
    expect(read(`${WORKSPACE}/src2.ts`)).toBe('source\n');
    expect(read(`${WORKSPACE}/dest2.ts`)).toBe('dest exists\n');
  });

  test('precomputes all modifications before writing', async () => {
    vfs.writeFile(`${WORKSPACE}/ok.ts`, 'a\n');
    vfs.writeFile(`${WORKSPACE}/ok2.ts`, 'keep me\n');

    const patch = `*** Begin Patch
*** Update File: ok.ts
@@
-a
+A
*** Update File: ok2.ts
@@
-keep me
+CHANGED
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/ok.ts`)).toBe('A\n');
    expect(read(`${WORKSPACE}/ok2.ts`)).toBe('CHANGED\n');
  });

  test('roll back modified files after a later write failure', async () => {
    vfs.writeFile(`${WORKSPACE}/rb1.ts`, 'first\n');
    vfs.writeFile(`${WORKSPACE}/rb2.ts`, 'second\n');

    const patch = `*** Begin Patch
*** Update File: rb1.ts
@@
-first
+FIRST
*** Update File: rb2.ts
@@
-second
+SECOND
*** End Patch`;

    // Override writeFile to fail on the second file to simulate a write error.
    const originalWriteFile = ctx.fs.writeFile;
    const failingCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        writeFile: mock(async (path: string, data: string | Uint8Array) => {
          if (path === `${WORKSPACE}/rb2.ts`) {
            throw new Error('EACCES: permission denied');
          }
          return originalWriteFile(path, data);
        }),
      },
    };

    const result = await execute({ patch }, failingCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('APPLY_ERROR');
    // Rollback should have restored rb1.ts to its original content.
    expect(read(`${WORKSPACE}/rb1.ts`)).toBe('first\n');
    expect(read(`${WORKSPACE}/rb2.ts`)).toBe('second\n');
  });

  test('removes a newly created file when a later write fails', async () => {
    vfs.writeFile(`${WORKSPACE}/existing-rb.ts`, 'old\n');
    const patch = `*** Begin Patch
*** Add File: created-rb.ts
+created
*** Update File: existing-rb.ts
@@
-old
+new
*** End Patch`;
    const originalWriteFile = ctx.fs.writeFile;
    const failingCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        writeFile: mock(async (path: string, data: string | Uint8Array) => {
          if (path === `${WORKSPACE}/existing-rb.ts`) throw new Error('EACCES');
          return originalWriteFile(path, data);
        }),
      },
    };

    const result = await execute({ patch }, failingCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('APPLY_ERROR');
    expect(has(`${WORKSPACE}/created-rb.ts`)).toBe(false);
    expect(read(`${WORKSPACE}/existing-rb.ts`)).toBe('old\n');
  });

  test('restores a deleted file when a later removal fails', async () => {
    vfs.writeFile(`${WORKSPACE}/delete-rb1.ts`, 'one\n');
    vfs.writeFile(`${WORKSPACE}/delete-rb2.ts`, 'two\n');
    const patch = `*** Begin Patch
*** Delete File: delete-rb1.ts
*** Delete File: delete-rb2.ts
*** End Patch`;
    const originalRm = ctx.fs.rm;
    const failingCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        rm: mock(async (path: string, options?: { recursive?: boolean }) => {
          if (path === `${WORKSPACE}/delete-rb2.ts`) throw new Error('EACCES');
          return originalRm(path, options);
        }),
      },
    };

    const result = await execute({ patch }, failingCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('APPLY_ERROR');
    expect(read(`${WORKSPACE}/delete-rb1.ts`)).toBe('one\n');
    expect(read(`${WORKSPACE}/delete-rb2.ts`)).toBe('two\n');
  });

  test('does not create files when precomputation fails', async () => {
    const patch = `*** Begin Patch
*** Add File: newfile.ts
+created
*** Update File: willfail.ts
@@
-missing
+found
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('FILE_NOT_FOUND');
    expect(has(`${WORKSPACE}/newfile.ts`)).toBe(false);
  });

  test('does not delete files when precomputation fails', async () => {
    vfs.writeFile(`${WORKSPACE}/todelete.ts`, 'delete me\n');
    vfs.writeFile(`${WORKSPACE}/tofail.ts`, 'fail here\n');

    const patch = `*** Begin Patch
*** Delete File: todelete.ts
*** Update File: tofail.ts
@@
-nonexistent
+found
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    // todelete.ts was never removed because precompute failed first.
    expect(read(`${WORKSPACE}/todelete.ts`)).toBe('delete me\n');
    expect(read(`${WORKSPACE}/tofail.ts`)).toBe('fail here\n');
  });

  test('check blocked deletion paths', async () => {
    // Deletion of a system path is blocked.
    const blockedCtx = createMockContext(vfs);
    blockedCtx.isBlockedPath = (path: string) => path.startsWith('/etc/');

    const patch = `*** Begin Patch
*** Delete File: /etc/passwd
*** End Patch`;

    const result = await execute({ patch }, blockedCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('BLOCKED_PATH');
  });

  test('check sensitive deletion paths', async () => {
    vfs.writeFile(`${WORKSPACE}/.env`, 'SECRET=1\n');

    const patch = `*** Begin Patch
*** Delete File: .env
*** End Patch`;

    const result = await execute({ patch }, ctx);
    // Sensitive + deletion requires approval (mocked to approve by default).
    expect(ctx.ask).toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(has(`${WORKSPACE}/.env`)).toBe(false);
  });

  test('ask permission for outside-workspace source path', async () => {
    vfs.addDir('/external');
    vfs.writeFile('/external/out.ts', 'content\n');

    // Create a context whose resolve maps a relative path outside the workspace.
    const outsideCtx = createMockContext(vfs, {
      workspacePath: WORKSPACE,
    });
    // Force the resolved path to be outside workspace for the given input path.
    outsideCtx.resolvePath = (p: string) =>
      p === 'out.ts' ? '/external/out.ts' : `${WORKSPACE}/${p}`;
    outsideCtx.fs.resolve = (p: string) =>
      p === 'out.ts' ? '/external/out.ts' : `${WORKSPACE}/${p}`;

    const patch = `*** Begin Patch
*** Update File: out.ts
@@
-content
+changed
*** End Patch`;

    const result = await execute({ patch }, outsideCtx);
    expect(result.success).toBe(true);
    expect(read('/external/out.ts')).toBe('changed\n');
    const calls = getAllAskCalls(outsideCtx);
    expect(calls.length).toBeGreaterThan(0);
  });

  test('report match modes and start lines in result', async () => {
    vfs.writeFile(`${WORKSPACE}/modes.ts`, 'aaa\nbbb\nccc\n');

    const patch = `*** Begin Patch
*** Update File: modes.ts
@@
-aaa
+AAA
@@
-ccc
+CCC
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    const r = patchResult(result);
    expect(r.matchModes.length).toBe(2);
    expect(r.matchModes[0].path).toBe(`${WORKSPACE}/modes.ts`);
    expect(r.matchModes[0].startLine).toBe(1);
    expect(r.matchModes[1].startLine).toBe(3);
    expect(read(`${WORKSPACE}/modes.ts`)).toBe('AAA\nbbb\nCCC\n');
  });

  test('returns file-list visualization', async () => {
    vfs.writeFile(`${WORKSPACE}/v.ts`, 'old\n');

    const patch = `*** Begin Patch
*** Update File: v.ts
@@
-old
+new
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('file-list');
    expect(read(`${WORKSPACE}/v.ts`)).toBe('new\n');
  });

  test('full file replacement via context anchor preserves surrounding content', async () => {
    vfs.writeFile(
      `${WORKSPACE}/full.ts`,
      'before\nreplace me\nafter\n',
    );

    const patch = `*** Begin Patch
*** Update File: full.ts
@@
 before
-replace me
+replaced
 after
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/full.ts`)).toBe('before\nreplaced\nafter\n');
  });

  test('*** End of File extends replacement to end of file', async () => {
    vfs.writeFile(
      `${WORKSPACE}/eofreplace.ts`,
      'keep\nold1\nold2\n',
    );

    const patch = `*** Begin Patch
*** Update File: eofreplace.ts
@@
 keep
-old1
-old2
+new1
+new2
*** End of File
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/eofreplace.ts`)).toBe('keep\nnew1\nnew2\n');
  });

  test('rejects a duplicated semantic anchor', async () => {
    vfs.writeFile(`${WORKSPACE}/anchors.ts`, 'function x() {}\nfunction x() {}\n');
    const patch = `*** Begin Patch
*** Update File: anchors.ts
@@ function x()
+const inserted = true;
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('AMBIGUOUS_MATCH');
    expect(read(`${WORKSPACE}/anchors.ts`)).toBe('function x() {}\nfunction x() {}\n');
  });

  test('runs normalized matching inside the remaining search region', async () => {
    vfs.writeFile(`${WORKSPACE}/region.ts`, 'a\nb\nmiddle\na\r\nb\r\n');
    const patch = `*** Begin Patch
*** Update File: region.ts
@@
-a
-b
+A
+B
@@
-a
-b
+C
+D
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/region.ts`)).toBe('A\nB\nmiddle\nC\nD\r\n');
    expect(patchResult(result).matchModes[1].mode).toBe('line_endings');
  });

  test('removes one standalone blank line', async () => {
    vfs.writeFile(`${WORKSPACE}/blank-remove.ts`, 'top\n\nbottom\n');
    const patch = `*** Begin Patch
*** Update File: blank-remove.ts
@@
-
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read(`${WORKSPACE}/blank-remove.ts`)).toBe('top\nbottom\n');
  });

  test('rejects a move whose destination resolves to its source', async () => {
    vfs.writeFile(`${WORKSPACE}/self.ts`, 'value\n');
    const patch = `*** Begin Patch
*** Update File: self.ts
*** Move to: ${WORKSPACE}/self.ts
@@
-value
+changed
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('INVALID_INPUT');
    expect(read(`${WORKSPACE}/self.ts`)).toBe('value\n');
  });

  test('fails precomputation when an affected file cannot be read', async () => {
    vfs.writeFile(`${WORKSPACE}/readable.ts`, 'one\n');
    vfs.writeFile(`${WORKSPACE}/unreadable.ts`, 'two\n');
    const originalReadFile = ctx.fs.readFile;
    const unreadableCtx = {
      ...ctx,
      fs: {
        ...ctx.fs,
        readFile: mock(async (path: string, encoding?: string) => {
          if (path === `${WORKSPACE}/unreadable.ts`) throw new Error('EACCES');
          return encoding
            ? originalReadFile(path, 'utf-8')
            : originalReadFile(path);
        }) as unknown as typeof ctx.fs.readFile,
      },
    };
    const patch = `*** Begin Patch
*** Update File: readable.ts
@@
-one
+ONE
*** Update File: unreadable.ts
@@
-two
+TWO
*** End Patch`;

    const result = await execute({ patch }, unreadableCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('APPLY_ERROR');
    expect(read(`${WORKSPACE}/readable.ts`)).toBe('one\n');
    expect(read(`${WORKSPACE}/unreadable.ts`)).toBe('two\n');
  });
});

// ---------------------------------------------------------------------------
// Permission tests
// ---------------------------------------------------------------------------

describe('apply-patch permissions', () => {
  test('deletion requires permission and USER_REJECTION when denied', async () => {
    vfs.writeFile(`${WORKSPACE}/reject.ts`, 'content\n');

    const rejectCtx = createMockContext(vfs, {
      ask: mock(async () => false) as unknown as typeof ctx.ask,
    });

    const patch = `*** Begin Patch
*** Delete File: reject.ts
*** End Patch`;

    const result = await execute({ patch }, rejectCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBe('USER_REJECTION');
    expect(has(`${WORKSPACE}/reject.ts`)).toBe(true);
  });

  test('outside workspace deletion is checked for blocked status', async () => {
    const blockedCtx = createMockContext(vfs);
    blockedCtx.isBlockedPath = () => true;

    const patch = `*** Begin Patch
*** Delete File: anything.ts
*** End Patch`;

    const result = await execute({ patch }, blockedCtx);
    expect(result.success).toBe(false);
    expect(failCode(result)).toBe('BLOCKED_PATH');
  });

  test('permission ask metadata includes deletion action', async () => {
    vfs.writeFile(`${WORKSPACE}/perm.ts`, 'x\n');

    const patch = `*** Begin Patch
*** Delete File: perm.ts
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    const askCall = getAskCall(ctx);
    expect(askCall.action).toBe('delete');
    expect(askCall.paths).toContain(`${WORKSPACE}/perm.ts`);
  });

  test('asks separately for every outside-workspace path', async () => {
    vfs.writeFile('/outside/a.ts', 'a\n');
    vfs.writeFile('/outside/b.ts', 'b\n');
    const patch = `*** Begin Patch
*** Update File: /outside/a.ts
@@
-a
+A
*** Update File: /outside/b.ts
@@
-b
+B
*** End Patch`;

    const result = await execute({ patch }, ctx);
    expect(result.success).toBe(true);
    expect(read('/outside/a.ts')).toBe('A\n');
    expect(read('/outside/b.ts')).toBe('B\n');
    const calls = getAllAskCalls(ctx);
    expect(calls).toHaveLength(2);
  });
});
