import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createFilesApplication } from '@/application/files';
import { createJean2FilesApplicationPort } from '@/adapters/jean2/files';
import {
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '@/application/http-errors';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

const temporaryDirectories: string[] = [];

function tempRoot(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

describe('file tree listing and mutations (S5 filesystem isolation)', () => {
  let workspaceId: string;
  let main: string;

  beforeEach(() => {
    setupTestDatabase();
    main = tempRoot('capek-file-tree');
    workspaceId = seedWorkspace({ id: 'ws-tree', path: main }).id;
  });

  afterEach(() => {
    resetTestDatabase();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function files() {
    return createFilesApplication(createJean2FilesApplicationPort());
  }

  test('tree lists every visible path recursively, sorted', async () => {
    mkdirSync(join(main, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(main, 'b.txt'), 'b');
    writeFileSync(join(main, 'sub/a.txt'), 'a');
    writeFileSync(join(main, 'sub/deep/c.ts'), 'c');

    const result = await files().listTreePaths(workspaceId, {});

    expect(result.root).toBe(resolve(main));
    expect(result.isMain).toBe(true);
    expect(result.truncated).toBe(false);
    expect(result.paths).toEqual([
      'b.txt',
      'sub/',
      'sub/a.txt',
      'sub/deep/',
      'sub/deep/c.ts',
    ]);
  });

  test('tree excludes node_modules and .git via the ignore filter', async () => {
    mkdirSync(join(main, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(main, 'node_modules/pkg/index.js'), 'x');
    mkdirSync(join(main, '.git'), { recursive: true });
    writeFileSync(join(main, '.git/config'), 'x');

    const result = await files().listTreePaths(workspaceId, {});
    expect(result.paths).toEqual([]);
  });

  test('create makes an empty file with parents by default', async () => {
    const result = await files().createFileEntry(workspaceId, {
      path: 'src/new-dir/new-file.ts',
    });

    expect(result.path).toBe('src/new-dir/new-file.ts');
    const app = files();
    const read = await app.readEditableFile(workspaceId, result.path);
    expect(read.content).toBe('');

    // Tree output distinguishes directories with a trailing slash.
    const tree = await files().listTreePaths(workspaceId, {});
    expect(tree.paths).toContain('src/');
    expect(tree.paths).toContain('src/new-dir/');
    expect(tree.paths).toContain('src/new-dir/new-file.ts');
  });

  test('create refuses existing entries and binary extensions', async () => {
    writeFileSync(join(main, 'exists.txt'), 'data');

    await expect(
      files().createFileEntry(workspaceId, { path: 'exists.txt' }),
    ).rejects.toThrow(ConflictError);

    await expect(
      files().createFileEntry(workspaceId, { path: 'logo.png' }),
    ).rejects.toThrow(BadRequestError);
  });

  test('create directory kind; a file rename onto it stays forbidden', async () => {
    const dirResult = await files().createFileEntry(workspaceId, {
      path: 'new-dir',
      kind: 'directory',
    });
    expect(dirResult.path).toBe('new-dir');

    writeFileSync(join(main, 'other.txt'), 'o');
    await expect(
      files().renameFileEntry(workspaceId, { from: 'other.txt', to: 'new-dir' }),
    ).rejects.toThrow(ConflictError);
  });

  test('rename renames files and validates destination conflicts', async () => {
    writeFileSync(join(main, 'old.txt'), 'data');

    const result = await files().renameFileEntry(workspaceId, {
      from: 'old.txt',
      to: 'renamed.txt',
    });
    expect(result).toEqual({ path: 'renamed.txt', from: 'old.txt' });
    const read = await files().readEditableFile(workspaceId, 'renamed.txt');
    expect(read.content).toBe('data');

    writeFileSync(join(main, 'taken.txt'), 'taken');
    await expect(
      files().renameFileEntry(workspaceId, { from: 'renamed.txt', to: 'taken.txt' }),
    ).rejects.toThrow(ConflictError);

    // overwrite replaces an existing destination file
    const overwritten = await files().renameFileEntry(workspaceId, {
      from: 'renamed.txt',
      to: 'taken.txt',
      overwrite: true,
    });
    expect(overwritten.path).toBe('taken.txt');
  });

  test('rename never overwrites directories even with overwrite', async () => {
    writeFileSync(join(main, 'move-me.txt'), 'm');
    mkdirSync(join(main, 'adir'));
    await expect(
      files().renameFileEntry(workspaceId, {
        from: 'move-me.txt',
        to: 'adir',
        overwrite: true,
      }),
    ).rejects.toThrow(ConflictError);
  });

  test('rename refuses moving a directory into its own subtree', async () => {
    mkdirSync(join(main, 'parent/child'), { recursive: true });

    await expect(
      files().renameFileEntry(workspaceId, {
        from: 'parent',
        to: 'parent/child/again',
      }),
    ).rejects.toThrow(BadRequestError);
  });

  test('delete removes files; non-empty dirs require recursive', async () => {
    writeFileSync(join(main, 'doomed.txt'), 'd');
    await files().deleteFileEntry(workspaceId, { path: 'doomed.txt' });
    const tree = await files().listTreePaths(workspaceId, {});
    expect(tree.paths).toEqual([]);

    mkdirSync(join(main, 'stuff'), { recursive: true });
    writeFileSync(join(main, 'stuff/inside.txt'), 'i');
    let caught: unknown;
    try {
      await files().deleteFileEntry(workspaceId, { path: 'stuff' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    // The directory survives the failed delete.
    const after = await files().listTreePaths(workspaceId, {});
    expect(after.paths).toContain('stuff/inside.txt');
  });

  test('delete recursive clears nested content in one call', async () => {
    mkdirSync(join(main, 'branch/twig'), { recursive: true });
    writeFileSync(join(main, 'branch/twig/leaf.txt'), 'l');

    const result = await files().deleteFileEntry(workspaceId, {
      path: 'branch',
      recursive: true,
    });
    expect(result).toEqual({ path: 'branch', recursive: true });

    const tree = await files().listTreePaths(workspaceId, {});
    expect(tree.paths).toEqual([]);
  });

  test('traversal and absolute paths are denied across all mutations', async () => {
    const outside = tempRoot('capek-tree-outside');
    writeFileSync(join(outside, 'secret.txt'), 's');

    for (const run of [
      () => files().createFileEntry(workspaceId, { path: `../${outside.split('/').pop()}/evil.txt` }),
      () => files().renameFileEntry(workspaceId, { from: '../outside', to: 'inside.txt' }),
      () => files().renameFileEntry(workspaceId, { from: 'a.txt', to: '/abs.txt' }),
      () => files().renameFileEntry(workspaceId, { from: '/abs-in.txt', to: 'ok.txt' }),
      () => files().deleteFileEntry(workspaceId, { path: '../../etc' }),
    ]) {
      let caught: unknown;
      try {
        await run();
      } catch (err) {
        caught = err;
      }
      expect(
        caught instanceof ForbiddenError || caught instanceof BadRequestError,
      ).toBe(true);
    }
  });
});
