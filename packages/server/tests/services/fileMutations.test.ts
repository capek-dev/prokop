import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync, lstatSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createEditableFileOps } from '@/infrastructure/filesystem/file-mutations';

const { readEditableFile, saveFile } = createEditableFileOps(workspacePathPolicyPort);
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  BadRequestError,
  PayloadTooLargeError,
} from '@/utils/http-errors';
import { FILE_PREVIEW_MAX_BYTES } from '@/utils/binaryDetection';

let workspaceDir: string;
let outsideDir: string;
const dirs: string[] = [];

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

beforeEach(() => {
  workspaceDir = join(tmpdir(), `jean2-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  outsideDir = join(tmpdir(), `jean2-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  dirs.push(workspaceDir, outsideDir);
});

afterEach(() => {
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  dirs.length = 0;
});

describe('fileMutations - readEditableFile', () => {
  test('reads a UTF-8 text file with content, revision, and metadata', async () => {
    const filePath = join(workspaceDir, 'hello.ts');
    const content = 'export const x = 42;\n';
    writeFileSync(filePath, content, 'utf-8');

    const result = await readEditableFile(
      { path: workspaceDir, additionalPaths: [] },
      'hello.ts',
    );

    expect(result.content).toBe(content);
    expect(result.revision).toBe(sha256(content));
    expect(result.readOnly).toBe(false);
    expect(result.encoding).toBe('utf-8');
    expect(result.name).toBe('hello.ts');
    expect(result.extension).toBe('.ts');
    expect(result.language).toBe('typescript');
    expect(result.size).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(result.path).toBe('hello.ts');
  });

  test('returns path relative to selected additional root', async () => {
    const sub = join(workspaceDir, 'sub');
    mkdirSync(sub);
    const filePath = join(sub, 'note.md');
    writeFileSync(filePath, '# hi\n');

    const result = await readEditableFile(
      { path: workspaceDir, additionalPaths: [sub] },
      'note.md',
      sub,
    );

    expect(result.path).toBe('note.md');
    expect(result.language).toBe('markdown');
  });

  test('rejects a directory', async () => {
    mkdirSync(join(workspaceDir, 'a-dir'));
    await expect(
      readEditableFile({ path: workspaceDir, additionalPaths: [] }, 'a-dir'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('rejects a missing file', async () => {
    await expect(
      readEditableFile({ path: workspaceDir, additionalPaths: [] }, 'nope.ts'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('rejects a binary file by extension', async () => {
    const filePath = join(workspaceDir, 'image.png');
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await expect(
      readEditableFile({ path: workspaceDir, additionalPaths: [] }, 'image.png'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('rejects a file exceeding the preview byte limit', async () => {
    const filePath = join(workspaceDir, 'big.txt');
    const buf = Buffer.alloc(FILE_PREVIEW_MAX_BYTES + 1, 0x61);
    writeFileSync(filePath, buf);
    await expect(
      readEditableFile({ path: workspaceDir, additionalPaths: [] }, 'big.txt'),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  test('rejects path traversal outside the workspace', async () => {
    const outsideFile = join(outsideDir, 'secret.txt');
    writeFileSync(outsideFile, 'secret');
    await expect(
      readEditableFile(
        { path: workspaceDir, additionalPaths: [] },
        `../${outsideDir.split('/').pop()}/secret.txt`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('rejects a symlink that escapes allowed roots', async () => {
    const outsideFile = join(outsideDir, 'escape.txt');
    writeFileSync(outsideFile, 'escaped');
    const linkPath = join(workspaceDir, 'link.txt');
    symlinkSync(outsideFile, linkPath);

    await expect(
      readEditableFile({ path: workspaceDir, additionalPaths: [] }, 'link.txt'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('rejects an absolute path into an additional root when main root is selected', async () => {
    const addRoot = join(workspaceDir, 'extra');
    mkdirSync(addRoot);
    const addFile = join(addRoot, 'secret.txt');
    writeFileSync(addFile, 'secret\n');

    await expect(
      readEditableFile(
        { path: workspaceDir, additionalPaths: [addRoot] },
        addFile,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('fileMutations - saveFile', () => {
  test('saves content and returns a new revision on a fresh revision match', async () => {
    const filePath = join(workspaceDir, 'save.ts');
    const original = 'line one\n';
    writeFileSync(filePath, original, 'utf-8');

    const read = await readEditableFile(
      { path: workspaceDir, additionalPaths: [] },
      'save.ts',
    );

    const updated = 'line one\nline two\n';
    const result = await saveFile(
      { path: workspaceDir, additionalPaths: [] },
      { path: 'save.ts', content: updated, expectedRevision: read.revision },
    );

    expect(result.path).toBe('save.ts');
    expect(result.revision).toBe(sha256(updated));
    expect(result.size).toBe(Buffer.byteLength(updated, 'utf-8'));
    expect(result.modifiedAt).toBeDefined();

    const onDisk = Bun.file(filePath);
    expect(await onDisk.text()).toBe(updated);
  });

  test('throws ConflictError with current content when revision is stale', async () => {
    const filePath = join(workspaceDir, 'conflict.txt');
    const original = 'original\n';
    writeFileSync(filePath, original, 'utf-8');

    const read = await readEditableFile(
      { path: workspaceDir, additionalPaths: [] },
      'conflict.txt',
    );

    const changed = 'someone else changed this\n';
    writeFileSync(filePath, changed, 'utf-8');

    let caught: unknown;
    try {
      await saveFile(
        { path: workspaceDir, additionalPaths: [] },
        { path: 'conflict.txt', content: 'my edit\n', expectedRevision: read.revision },
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConflictError);
    const err = caught as ConflictError;
    const details = err.details as {
      path: string;
      expectedRevision: string;
      actualRevision: string;
      currentContent: string;
    };
    expect(details.path).toBe('conflict.txt');
    expect(details.expectedRevision).toBe(read.revision);
    expect(details.actualRevision).toBe(sha256(changed));
    expect(details.currentContent).toBe(changed);
  });

  test('rejects a stale revision when force is true', async () => {
    const filePath = join(workspaceDir, 'force.txt');
    writeFileSync(filePath, 'original\n', 'utf-8');

    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        {
          path: 'force.txt',
          content: 'forced\n',
          expectedRevision: 'stale-revision',
          force: true,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const onDisk = Bun.file(filePath);
    expect(await onDisk.text()).toBe('original\n');
  });

  test('rejects a missing target file', async () => {
    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        { path: 'missing.txt', content: 'brand new\n', expectedRevision: sha256('') },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('rejects content exceeding the preview byte limit', async () => {
    const filePath = join(workspaceDir, 'small.txt');
    writeFileSync(filePath, 'small');

    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        {
          path: 'small.txt',
          content: 'a'.repeat(FILE_PREVIEW_MAX_BYTES + 1),
          expectedRevision: sha256('small'),
        },
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  test('rejects saving over a directory', async () => {
    mkdirSync(join(workspaceDir, 'a-dir'));
    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        { path: 'a-dir', content: 'x', expectedRevision: sha256('') },
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('rejects path traversal outside the workspace', async () => {
    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        { path: '../../etc/passwd', content: 'x', expectedRevision: sha256('') },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('rejects a symlink parent directory that escapes the selected root', async () => {
    writeFileSync(join(outsideDir, 'pwned.txt'), 'escaped');
    const linkDir = join(workspaceDir, 'escape-dir');
    symlinkSync(outsideDir, linkDir);

    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [] },
        { path: 'escape-dir/pwned.txt', content: 'x', expectedRevision: sha256('') },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('rejects an absolute path into an additional root when main root is selected', async () => {
    const addRoot = join(workspaceDir, 'extra');
    mkdirSync(addRoot);
    const addFile = join(addRoot, 'secret.txt');
    writeFileSync(addFile, 'secret\n');

    await expect(
      saveFile(
        { path: workspaceDir, additionalPaths: [addRoot] },
        { path: addFile, content: 'x', expectedRevision: sha256('secret\n') },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('saves into a selected additional root', async () => {
    const addRoot = join(workspaceDir, 'extra');
    mkdirSync(addRoot);
    const addFile = join(addRoot, 'note.txt');
    writeFileSync(addFile, 'original\n');

    const result = await saveFile(
      { path: workspaceDir, additionalPaths: [addRoot] },
      { path: 'note.txt', content: 'updated\n', expectedRevision: sha256('original\n'), root: addRoot },
    );

    expect(result.path).toBe('note.txt');
    expect(result.revision).toBe(sha256('updated\n'));
  });

  test('preserves the existing file mode (executable bit)', async () => {
    const filePath = join(workspaceDir, 'script.sh');
    writeFileSync(filePath, 'echo hi\n', 'utf-8');
    chmodSync(filePath, 0o755);

    const read = await readEditableFile(
      { path: workspaceDir, additionalPaths: [] },
      'script.sh',
    );
    await saveFile(
      { path: workspaceDir, additionalPaths: [] },
      { path: 'script.sh', content: 'echo bye\n', expectedRevision: read.revision },
    );

    const stats = Bun.file(filePath);
    const mode = (await stats.stat()).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  test('replaces the symlink target, not the symlink entry itself', async () => {
    const targetFile = join(workspaceDir, 'real.txt');
    writeFileSync(targetFile, 'real content\n', 'utf-8');
    const linkPath = join(workspaceDir, 'link.txt');
    symlinkSync(targetFile, linkPath);

    const read = await readEditableFile(
      { path: workspaceDir, additionalPaths: [] },
      'link.txt',
    );

    await saveFile(
      { path: workspaceDir, additionalPaths: [] },
      { path: 'link.txt', content: 'updated through link\n', expectedRevision: read.revision },
    );

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(readFileSync(targetFile, 'utf-8')).toBe('updated through link\n');
  });
});
