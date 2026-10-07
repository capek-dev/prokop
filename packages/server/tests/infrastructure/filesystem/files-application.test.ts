import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, resolve } from 'path';
import type { FileTreeMessage, GitStatusMessage } from '@prokopai/sdk';
import { createFilesApplication } from '@/application/files';
import { createProkopFilesApplicationPort } from '@/adapters/prokop/files';
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
    return createFilesApplication(createProkopFilesApplicationPort());
  }

  test('Git add resolves available worktree roots and rejects unavailable roots', async () => {
    const worktree = realpathSync(tempRoot('git-add-worktree'));
    for (const path of [main, worktree]) {
      const result = Bun.spawnSync(['git', '-C', path, 'init', '-q']);
      expect(result.exitCode).toBe(0);
      writeFileSync(join(path, 'new.txt'), 'new');
    }
    let available = true;
    const app = createFilesApplication(createProkopFilesApplicationPort({
      listAvailableWorktreePaths: () => available ? [worktree] : [],
    }));
    await expect(app.gitAdd(workspaceId, 'new.txt', worktree)).resolves.toEqual({ path: 'new.txt' });
    expect((await app.gitStatus(workspaceId, worktree)).files[0].git.staged).toBe(true);
    const mainIndex = Bun.spawnSync(['git', '-C', main, 'ls-files']);
    expect(mainIndex.exitCode).toBe(0);
    expect(mainIndex.stdout.toString()).toBe('');
    available = false;
    await expect(app.gitAdd(workspaceId, 'new.txt', worktree)).rejects.toThrow('Path outside workspace');
    expect(Bun.spawnSync(['git', '-C', main, 'ls-files']).stdout.toString()).toBe('');
    await expect(app.gitAdd('missing-workspace', 'new.txt')).rejects.toThrow('Workspace not found');
  });

  test('Rebase reads and mutations reject unavailable roots and emit after partial failures', async () => {
    const port = createProkopFilesApplicationPort();
    const calls: string[] = [];
    const state = { active: false, token: null, branch: null, originalHead: null, onto: null, conflicts: [] };
    port.gitRebaseState = async (root) => { calls.push(root); return state; };
    port.gitRebaseStart = async (root) => { calls.push(root); throw new Error('Git operation: partial failure'); };
    const events: unknown[] = [];
    const app = createFilesApplication(port, (...args) => { events.push(args); });
    const root = '/unavailable';
    expect(() => app.gitRebaseState(workspaceId, root)).toThrow('Path outside workspace');
    expect(() => app.gitRebaseConflict(workspaceId, { root, path: 'file' })).toThrow('Path outside workspace');
    await expect(app.gitRebaseStart(workspaceId, { root, expectedBranch: 'feature', expectedHead: 'a'.repeat(40), baseBranch: 'main', baseHead: 'b'.repeat(40) })).rejects.toThrow('Path outside workspace');
    await expect(app.gitRebaseControl(workspaceId, { root, action: 'abort', token: 'c'.repeat(64) })).rejects.toThrow('Path outside workspace');
    await expect(app.gitRebaseResolve(workspaceId, { root, path: 'file', token: 'c'.repeat(64), resolution: 'delete' })).rejects.toThrow('Path outside workspace');
    expect(calls).toEqual([]);
    expect(events).toEqual([]);
    await expect(app.gitRebaseStart(workspaceId, { expectedBranch: 'feature', expectedHead: 'a'.repeat(40), baseBranch: 'main', baseHead: 'b'.repeat(40) })).rejects.toThrow('partial failure');
    expect(events).toEqual([[workspaceId, main]]);
  });

  test('Git commit/push reject unavailable roots before mutation', async () => {
    const app = files();
    const root = tempRoot('unavailable-git-root');
    await expect(app.gitCommit(workspaceId, { root, paths: ['a'], message: 'x', expectedBranch: 'main', expectedHead: null })).rejects.toThrow('Path outside workspace');
    await expect(app.gitPush(workspaceId, { root, remote: 'origin', branch: 'main', expectedBranch: 'main', expectedHead: 'a'.repeat(40) })).rejects.toThrow('Path outside workspace');
    expect(() => app.gitRepository(workspaceId, root)).toThrow('Path outside workspace');
    await expect(app.gitRemoveStagedAddition(workspaceId, 'new', root)).rejects.toThrow('Path outside workspace');
    await expect(app.gitRevertModifiedFile(workspaceId, 'changed', root)).rejects.toThrow('Path outside workspace');
  });

  test('Git revert emits a change event after success or failure', async () => {
    const port = createProkopFilesApplicationPort();
    const calls: string[] = [];
    port.gitRevertModifiedFile = async (root, path) => {
      calls.push(`${root}:${path}`);
      if (path === 'fail') throw new Error('Git operation: failed');
      return { path };
    };
    const events: unknown[] = [];
    const app = createFilesApplication(port, (...args) => { events.push(args); });

    await expect(app.gitRevertModifiedFile(workspaceId, 'ok')).resolves.toEqual({ path: 'ok' });
    await expect(app.gitRevertModifiedFile(workspaceId, 'fail')).rejects.toThrow('Git operation: failed');
    expect(calls).toEqual([`${main}:ok`, `${main}:fail`]);
    expect(events).toEqual([[workspaceId, main], [workspaceId, main]]);
  });

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

  test('search excludes gitignored paths while the tree includes them', async () => {
    writeFileSync(join(main, '.gitignore'), '*.log\n');
    writeFileSync(join(main, 'secret.log'), 'secret');
    writeFileSync(join(main, 'notes.txt'), 'notes');

    const ignoredSearch = await files().list(workspaceId, { path: '', search: 'secret' });
    expect(ignoredSearch.files).toEqual([]);

    const visibleSearch = await files().list(workspaceId, { path: '', search: 'notes' });
    expect(visibleSearch.files.map((entry) => entry.name)).toEqual(['notes.txt']);

    const tree = await files().listTreePaths(workspaceId, {});
    expect(tree.paths).toContain('secret.log');
  });

  test('tree reads share the pushed feed and app file actions push the change', async () => {
    writeFileSync(join(main, 'a.txt'), 'a');
    const pushed: FileTreeMessage[] = [];
    const app = createFilesApplication(createProkopFilesApplicationPort(), undefined, {
      deliverFileTree: (_subscriber, message) => { pushed.push(message); },
    });
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
    };

    const first = await app.listTreePaths(workspaceId, {});
    expect(first.paths).toEqual(['a.txt']);
    expect(first.revision).toBeGreaterThan(0);

    app.fileTreeFeed.subscribe('c1', workspaceId);
    await until(() => pushed.length === 1);
    expect(pushed[0]).toMatchObject({ type: 'files.tree', workspaceId, root: resolve(main), update: { kind: 'snapshot' } });

    await app.createFileEntry(workspaceId, { path: 'b.txt' });
    await until(() => pushed.length === 2);
    expect(pushed[1]!.update).toMatchObject({ kind: 'delta', added: ['b.txt'], removed: [] });
    app.fileTreeFeed.disconnect('c1');

    // A manual refresh rewalks a watched root instead of serving its cached tree.
    app.fileTreeFeed.subscribe('c2', workspaceId);
    await until(() => pushed.length === 3);
    writeFileSync(join(main, 'outside-tools.txt'), 'x');
    expect((await app.listTreePaths(workspaceId, {})).paths).not.toContain('outside-tools.txt');
    expect((await app.listTreePaths(workspaceId, { fresh: true })).paths).toContain('outside-tools.txt');
    app.fileTreeFeed.disconnect('c2');

    // Invalid roots and hidden-file filtering keep the direct walk and its errors.
    await expect(app.listTreePaths(workspaceId, { root: tempRoot('outside-root') })).rejects.toThrow('Invalid workspace root');
    expect((await app.listTreePaths(workspaceId, { showHidden: false })).revision).toBeUndefined();
  });

  test('explorer deletes and editor saves push Git status; manual refresh recomputes', async () => {
    const git = (...args: string[]) => expect(Bun.spawnSync(['git', '-C', main, ...args]).exitCode).toBe(0);
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(main, 'gone.txt'), 'gone');
    writeFileSync(join(main, 'edit.txt'), 'before');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    const pushed: GitStatusMessage[] = [];
    const app = createFilesApplication(createProkopFilesApplicationPort(), undefined, {
      deliverGitStatus: (_subscriber, message) => { pushed.push(message); },
    });
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5);
    };
    const changed = (message: GitStatusMessage | undefined) =>
      message?.status.files.map((file) => `${file.git.status} ${file.path}`).sort();

    app.gitStatusFeed.subscribe('changes-tab', workspaceId);
    await until(() => pushed.length === 1);
    expect(changed(pushed[0])).toEqual([]);

    await app.deleteFileEntry(workspaceId, { path: 'gone.txt' });
    await until(() => pushed.length === 2);
    expect(changed(pushed[1])).toEqual(['deleted gone.txt']);

    const read = await app.readEditableFile(workspaceId, 'edit.txt');
    await app.saveFile(workspaceId, { path: 'edit.txt', content: 'after', expectedRevision: read.revision });
    await until(() => pushed.length === 3);
    expect(changed(pushed[2])).toEqual(['deleted gone.txt', 'modified edit.txt']);

    // A terminal write reports nothing: plain reads serve the cache, refresh recomputes.
    writeFileSync(join(main, 'terminal.txt'), 'x');
    expect((await app.gitStatus(workspaceId)).files.map((file) => file.path)).not.toContain('terminal.txt');
    expect((await app.gitStatus(workspaceId, undefined, { fresh: true })).files.map((file) => file.path)).toContain('terminal.txt');
    app.gitStatusFeed.disconnect('changes-tab');
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
    const port = createProkopFilesApplicationPort();
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
    return createFilesApplication(createProkopFilesApplicationPort());
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
