import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createFilesApplication } from '@/application/files';
import { createProkopFilesApplicationPort } from '@/adapters/prokop/files';
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
    return createFilesApplication(createProkopFilesApplicationPort());
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

  test('outside Git, node_modules and build folders are listed as ignored but never walked', async () => {
    mkdirSync(join(main, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(main, 'node_modules/pkg/index.js'), 'x');
    mkdirSync(join(main, 'dist'), { recursive: true });
    writeFileSync(join(main, 'dist/app.js'), 'x');
    mkdirSync(join(main, '.git'), { recursive: true });
    writeFileSync(join(main, '.git/config'), 'x');
    writeFileSync(join(main, '.DS_Store'), 'x');

    const result = await files().listTreePaths(workspaceId, {});

    expect(result.paths).toEqual(['dist/', 'node_modules/']);
    expect(result.ignored).toEqual(['dist/', 'node_modules/']);
  });

  test('in a Git repository, ignored entries come from .gitignore and ignored folders are not walked', async () => {
    Bun.spawnSync(['git', 'init', '-q', main]);
    writeFileSync(join(main, '.gitignore'), '*.log\ncoverage/\n');
    writeFileSync(join(main, 'app.ts'), 'x');
    writeFileSync(join(main, 'debug.log'), 'x');
    mkdirSync(join(main, 'coverage'), { recursive: true });
    writeFileSync(join(main, 'coverage/lcov.info'), 'x');
    mkdirSync(join(main, 'dist'), { recursive: true });
    writeFileSync(join(main, 'dist/app.js'), 'x');
    mkdirSync(join(main, 'packages/web/node_modules/react'), { recursive: true });
    writeFileSync(join(main, 'packages/web/node_modules/react/index.js'), 'x');

    const result = await files().listTreePaths(workspaceId, {});

    // dist is not ignored here, so it is an ordinary folder; node_modules is never walked.
    expect(result.paths).toEqual([
      '.gitignore', 'app.ts', 'coverage/', 'debug.log', 'dist/', 'dist/app.js',
      'packages/', 'packages/web/', 'packages/web/node_modules/',
    ]);
    expect(result.ignored).toEqual(['coverage/', 'debug.log', 'packages/web/node_modules/']);
  });

  test('an ignored folder loads one level at a time', async () => {
    mkdirSync(join(main, 'node_modules/react/cjs'), { recursive: true });
    writeFileSync(join(main, 'node_modules/react/index.js'), 'x');
    writeFileSync(join(main, 'node_modules/react/cjs/react.js'), 'x');
    mkdirSync(join(main, 'node_modules/.bin'), { recursive: true });

    const top = await files().listTreeChildren(workspaceId, { path: 'node_modules' });
    expect(top.paths).toEqual(['node_modules/.bin/', 'node_modules/react/']);

    const react = await files().listTreeChildren(workspaceId, { path: 'node_modules/react' });
    expect(react).toMatchObject({ path: 'node_modules/react', paths: ['node_modules/react/cjs/', 'node_modules/react/index.js'], truncated: false });
  });

  test('loading a folder outside the root is refused', async () => {
    await expect(files().listTreeChildren(workspaceId, { path: '../elsewhere' })).rejects.toThrow();
  });

  test('tree includes paths matched by gitignore rules', async () => {
    writeFileSync(join(main, '.gitignore'), '*.log\n.env\ncoverage/\n');
    writeFileSync(join(main, 'secret.log'), 'secret');
    writeFileSync(join(main, '.env'), 'secret');
    mkdirSync(join(main, 'coverage'), { recursive: true });
    writeFileSync(join(main, 'coverage/lcov.info'), 'coverage');

    const result = await files().listTreePaths(workspaceId, {});

    expect(result.paths).toEqual([
      '.env',
      '.gitignore',
      'coverage/',
      'coverage/lcov.info',
      'secret.log',
    ]);
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
