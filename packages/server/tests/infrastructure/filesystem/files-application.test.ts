import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import { createFilesApplication } from '@/application/files';
import { createJean2FilesApplicationPort } from '@/adapters/jean2/files';
import { ConflictError } from '@/application/http-errors';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';

const temporaryDirectories: string[] = [];

function tempRoot(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('files application over the Jean2 port (S5 filesystem isolation)', () => {
  let workspaceId: string;
  let main: string;

  beforeEach(() => {
    setupTestDatabase();
    main = tempRoot('capek-files-app');
    workspaceId = seedWorkspace({ id: 'ws-files', path: main }).id;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function files() {
    return createFilesApplication(createJean2FilesApplicationPort());
  }

  test('browse lists entries in the exact order and shape', async () => {
    mkdirSync(join(main, 'sub'), { recursive: true });
    writeFileSync(join(main, 'b.txt'), 'b');
    writeFileSync(join(main, 'a.txt'), 'a');

    const result = await files().list(workspaceId, { path: '' });

    expect(result.mode).toBe('browse');
    expect(result.root).toBe(resolve(main));
    expect(result.isMain).toBe(true);
    expect(result.files.map((entry) => entry.name)).toEqual(['sub', 'a.txt', 'b.txt']);
    expect(result.files[0]).toMatchObject({ type: 'directory', path: 'sub' });
    expect(result.files[1]).toMatchObject({ type: 'file', extension: '.txt' });
  });

  test('search returns matching entries with the exact abort handling', async () => {
    writeFileSync(join(main, 'alpha.txt'), 'a');
    writeFileSync(join(main, 'beta.txt'), 'b');

    const result = await files().list(workspaceId, { path: '', search: 'alp' });
    expect(result.mode).toBe('search');
    expect(result.files.map((entry) => entry.name)).toEqual(['alpha.txt']);

    const controller = new AbortController();
    controller.abort();
    const aborted = await files().list(workspaceId, {
      path: '',
      search: 'alp',
      signal: controller.signal,
    });
    expect(aborted.files).toEqual([]);
  });

  test('browse denies paths outside the workspace with the exact error', async () => {
    const sibling = `${main}-other`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'x');

    await expect(files().list(workspaceId, {
      path: `../${sibling.split('/').pop()}`,
    })).rejects.toThrow('Path not found');
  });

  test('preview preserves the accepted containment tightening', async () => {
    writeFileSync(join(main, 'notes.txt'), 'valid content');
    const sibling = `${main}-other`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'sibling content');

    const preview = await files().previewFile(workspaceId, 'notes.txt');
    expect(preview).toMatchObject({ name: 'notes.txt', kind: 'text', readOnly: true });
    expect(preview).toHaveProperty('content', 'valid content');

    await expect(
      files().previewFile(workspaceId, join(sibling, 'secret.txt')),
    ).rejects.toThrow('Path outside workspace');
  });

  test('editable read and save round-trip with optimistic concurrency', async () => {
    writeFileSync(join(main, 'edit.txt'), 'original');

    const read = await files().readEditableFile(workspaceId, 'edit.txt');
    expect(read.content).toBe('original');
    expect(typeof read.revision).toBe('string');

    const saved = await files().saveFile(workspaceId, {
      path: 'edit.txt',
      content: 'updated',
      expectedRevision: read.revision,
    });
    expect(saved.revision).not.toBe(read.revision);
    expect(saved.size).toBe(7);

    // A stale revision must conflict with the exact error type.
    let caught: unknown;
    try {
      await files().saveFile(workspaceId, {
        path: 'edit.txt',
        content: 'stale write',
        expectedRevision: read.revision,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
  });

  test('read rejects paths escaping the root with the exact error type', async () => {
    const outside = tempRoot('capek-files-outside');
    writeFileSync(join(outside, 'outside.txt'), 'x');

    await expect(
      files().readEditableFile(workspaceId, join(outside, 'outside.txt')),
    ).rejects.toThrow('Path outside workspace');
  });

  test('missing workspaces produce the exact application error', async () => {
    await expect(files().list('missing', { path: '' }))
      .rejects.toThrow('Workspace not found');
    await expect(files().previewFile('missing', 'x'))
      .rejects.toThrow('Workspace not found');
  });

  test('git status returns a shaped availability result for a non-repo directory', async () => {
    // The temp workspace is not a git repository, so the exact pre-slice
    // not-a-repo availability shape must come back without throwing.
    const status = await files().gitStatus(workspaceId);
    expect(status.root).toBe(resolve(main));
    if (status.availability.available) {
      expect(Array.isArray(status.files)).toBe(true);
    } else {
      const reason = status.availability.reason;
      expect(reason === 'not_a_git_repo' || reason === 'git_error').toBe(true);
      expect(status.files).toEqual([]);
    }
  });

  test('expands browse paths through the C6 workspace path policy', () => {
    const port = createJean2FilesApplicationPort();
    const application = createFilesApplication(port);

    // `~/x` joins the active home directory exactly like the pre-slice
    // expandPath helper.
    expect(application.expandPathFor('~/notes.txt')).toBe(join(homedir(), 'notes.txt'));
    // `~user`-style inputs resolve verbatim against the process cwd (the
    // pre-slice browse anchoring), never against the home directory.
    expect(application.expandPathFor('~user/file.txt')).toBe(resolve('~user/file.txt'));
    expect(application.expandPathFor('~user/file.txt'))
      .not.toBe(join(homedir(), '~user/file.txt'));
  });
});

describe('files git diff containment (S5 review repair)', () => {
  let workspaceId: string;
  let main: string;

  beforeEach(() => {
    setupTestDatabase();
    main = tempRoot('capek-diff-main');
    workspaceId = seedWorkspace({ id: 'ws-diff', path: main }).id;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function files() {
    return createFilesApplication(createJean2FilesApplicationPort());
  }

  test('denies sibling-prefix and traversal-to-sibling diff paths before any git work', async () => {
    const sibling = `${main}-other`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'x');
    mkdirSync(join(main, 'sub'), { recursive: true });
    writeFileSync(join(main, 'notes.txt'), 'notes');

    const siblingDiff = await files().gitDiff(workspaceId, join(sibling, 'secret.txt'));
    expect(siblingDiff).toMatchObject({
      diffAvailable: false,
      reason: 'path_outside_workspace',
    });

    const traversalDiff = await files().gitDiff(
      workspaceId,
      `../${sibling.split('/').pop()}/secret.txt`,
    );
    expect(traversalDiff).toMatchObject({
      diffAvailable: false,
      reason: 'path_outside_workspace',
    });

    // Inside-root traversal stays allowed (the result may be any non-
    // containment reason such as not_a_git_repo).
    const insideDiff = await files().gitDiff(workspaceId, 'sub/../notes.txt');
    expect(insideDiff).not.toMatchObject({ reason: 'path_outside_workspace' });
  });

  test('declared additional roots remain allowed for git diff', async () => {
    const extra = tempRoot('capek-diff-extra');
    writeFileSync(join(extra, 'extra.txt'), 'x');
    updateWorkspace(workspaceId, { additionalPaths: [extra] });

    const diff = await files().gitDiff(workspaceId, join(extra, 'extra.txt'));
    expect(diff).not.toMatchObject({ reason: 'path_outside_workspace' });
  });
});
