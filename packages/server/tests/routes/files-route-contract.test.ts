import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { registerFileRoutes } from '@/transport/http/routes/files';
import { HttpError } from '@/application/http-errors';
import type { FilesApplication } from '@/application/files';

function makeFilesApplication(
  overrides: Partial<FilesApplication> = {},
): FilesApplication {
  return {
    list: async () => ({
      files: [],
      currentPath: '',
      mode: 'browse',
      root: '/ws',
      isMain: true,
    }),
    gitStatus: async () => ({
      availability: { available: false, reason: 'not_a_git_repo' },
      files: [],
      root: '/ws',
    }),
    listTreePaths: async () => ({
      root: '/ws',
      isMain: true,
      paths: ['a.txt', 'src', 'src/b.ts'],
      truncated: false,
    }),
    createFileEntry: async () => ({ path: 'created.txt' }),
    renameFileEntry: async () => ({ path: 'renamed.txt', from: 'old.txt' }),
    deleteFileEntry: async () => ({ path: 'gone.txt', recursive: false }),
    gitDiff: async () => ({
      path: 'file.txt',
      diffAvailable: false,
      reason: 'not_changed',
      hunks: [],
      additions: 0,
      deletions: 0,
    }),
    previewFile: async () => ({
      path: 'file.txt',
      name: 'file.txt',
      extension: '.txt',
      size: 4,
      kind: 'text',
      readOnly: true,
      content: 'data',
    }),
    readEditableFile: async () => ({
      path: 'file.txt',
      name: 'file.txt',
      extension: '.txt',
      size: 4,
      content: 'data',
      revision: 'rev',
      readOnly: false,
      encoding: 'utf-8',
    }),
    saveFile: async () => ({
      path: 'file.txt',
      revision: 'rev2',
      size: 5,
      modifiedAt: 'now',
    }),
    listDirectoryOnly: async () => [],
    expandPathFor: (inputPath: string) => inputPath,
    ...overrides,
  } as FilesApplication;
}

function filesApp(application: FilesApplication): Hono {
  const app = new Hono();
  registerFileRoutes(app, application);
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = {
        error: err.code,
        message: err.message,
      };
      if (err.details !== undefined) body.details = err.details;
      return c.json(body, err.status as never);
    }
    // The production app.ts onError shape for non-HttpError failures.
    return c.json({
      error: 'Internal Server Error',
      message: err.message || 'An unexpected error occurred',
      path: c.req.path,
      method: c.req.method,
    }, 500 as never);
  });
  return app;
}

describe('Rebase routes', () => {
  const token = 'b'.repeat(64);
  const state = { active: false, token: null, branch: null, originalHead: null, onto: null, conflicts: [] };
  test('forwards selected roots and exact resolution payloads', async () => {
    const calls: unknown[] = [];
    const app = filesApp(makeFilesApplication({
      gitRebaseState: async (...args) => { calls.push(args); return state; },
      gitRebaseStart: async (...args) => { calls.push(args); return state; },
      gitRebaseControl: async (...args) => { calls.push(args); return state; },
      gitRebaseResolve: async (...args) => { calls.push(args); return state; },
      gitRebaseConflict: async (...args) => { calls.push(args); return { path: 'file', token, base: null, feature: null, workingText: null }; },
    }));
    expect((await app.request('/api/workspaces/ws/git/rebase?root=%2Ftree')).status).toBe(200);
    const inputs = [
      ['start', { root: '/tree', expectedBranch: 'feature', expectedHead: 'a'.repeat(40), baseBranch: 'main', baseHead: 'c'.repeat(40) }],
      ['control', { root: '/tree', action: 'abort', token }],
      ['resolve', { root: '/tree', path: 'line\nbreak', token, resolution: 'text', text: '' }],
      ['conflict', { root: '/tree', path: 'file' }],
    ] as const;
    for (const [route, input] of inputs) expect((await app.request(`/api/workspaces/ws/git/rebase/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(200);
    expect(calls).toEqual([['ws', '/tree'], ...inputs.map(([, input]) => ['ws', input])]);
  });
  test.each([
    ['control', { action: 'skip', token }],
    ['control', { action: 'abort' }],
    ['resolve', { path: 'file', token, resolution: 'text' }],
    ['resolve', { path: 'file', token, resolution: 'base', text: 'unexpected' }],
    ['start', { expectedBranch: 'feature', expectedHead: 'HEAD', baseBranch: 'main', baseHead: 'a'.repeat(40) }],
  ])('rejects malformed %s without mutation', async (route, input) => {
    const app = filesApp(makeFilesApplication());
    expect((await app.request(`/api/workspaces/ws/git/rebase/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status).toBe(400);
  });
  test('maps stale resolution and unavailable root errors', async () => {
    const app = filesApp(makeFilesApplication({ gitRebaseState: async () => { throw new Error('Path outside workspace'); }, gitRebaseControl: async () => { throw new Error('Git operation: rebase changed'); } }));
    expect((await app.request('/api/workspaces/ws/git/rebase?root=%2Fgone')).status).toBe(403);
    expect((await app.request('/api/workspaces/ws/git/rebase/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'abort', token }) })).status).toBe(409);
  });
});

describe('Remove staged addition route', () => {
  test('forwards the exact path and root and rejects malformed paths', async () => {
    const calls: unknown[] = [];
    const app = filesApp(makeFilesApplication({ gitRemoveStagedAddition: async (...args) => { calls.push(args); return { path: args[1] }; } }));
    const request = (path: string) => app.request('/api/workspaces/ws/git/remove-staged-addition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, root: '/worktree' }) });
    expect((await request('new[1]')).status).toBe(200);
    expect((await request('../outside')).status).toBe(400);
    expect(calls).toEqual([['ws', 'new[1]', '/worktree']]);
  });
});

describe('Git commit and push routes', () => {
  test('commit forwards selected whole files and the expected branch/root', async () => {
    const input = { paths: ['a', 'line\nbreak'], message: 'Commit files', expectedBranch: 'main', expectedHead: null, root: '/worktree' };
    let received: unknown;
    const app = filesApp(makeFilesApplication({ gitCommit: async (_id, body) => { received = body; return { head: 'a'.repeat(40) }; } }));
    const response = await app.request('/api/workspaces/ws/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    expect(received).toEqual(input);
  });
  test.each([
    ['commit', { paths: [], message: 'x', expectedBranch: 'main', expectedHead: null }],
    ['commit', { paths: ['../escape'], message: 'x', expectedBranch: 'main', expectedHead: null }],
    ['commit', { paths: ['a'], message: ' ', expectedBranch: 'main', expectedHead: null }],
    ['push', { remote: 'origin', branch: 'main', expectedBranch: 'main', expectedHead: 'a'.repeat(40), force: true }],
    ['push', { remote: '--all', branch: 'main', expectedBranch: 'main', expectedHead: 'a'.repeat(40) }],
    ['push', { remote: 'origin', branch: 'main', expectedBranch: 'main', expectedHead: 'a'.repeat(40), force: 'true' }],
  ])('rejects malformed %s before mutation', async (operation, input) => {
    let called = false;
    const app = filesApp(makeFilesApplication({ gitCommit: async () => { called = true; return { head: '' }; }, gitPush: async () => { called = true; return { head: '' }; } }));
    const response = await app.request(`/api/workspaces/ws/git/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });
});

describe('Git add route', () => {
  test('delegates the selected root and file to the application', async () => {
    const calls: unknown[] = [];
    const app = filesApp(makeFilesApplication({
      gitAdd: async (...args) => { calls.push(args); return { path: args[1] }; },
    }));
    const response = await app.request('/api/workspaces/ws-1/git/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/new.ts', root: '/worktree' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ path: 'src/new.ts' });
    expect(calls).toEqual([['ws-1', 'src/new.ts', '/worktree']]);
  });

  test.each([{}, { path: '' }, { path: [] }, { path: '../file' }, { path: '.' },
    { path: '/file' }, { path: 'C:\\file' }, { path: 'bad\0file' }, { path: '.git/config' },
    { path: 'file', root: 123 }, { path: 'file', root: '' },
  ])('rejects malformed input %j before delegation', async (body) => {
    let called = false;
    const app = filesApp(makeFilesApplication({ gitAdd: async () => { called = true; return { path: '' }; } }));
    const response = await app.request('/api/workspaces/ws-1/git/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  test.each([
    ['Workspace not found', 404], ['Path outside workspace', 403],
    ['Only untracked files can be added to Git', 409], ['Git add failed: index locked', 400],
  ] as const)('maps %s to %d', async (message, status) => {
    const app = filesApp(makeFilesApplication({ gitAdd: async () => { throw new Error(message); } }));
    const response = await app.request('/api/workspaces/ws-1/git/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: 'new.txt' }),
    });
    expect(response.status).toBe(status);
  });
});

describe('files route contract (S5 filesystem isolation)', () => {
  test('the files list endpoint delegates every option to the application', async () => {
    const calls: Array<unknown> = [];
    const application = makeFilesApplication({
      list: async (workspaceId, options) => {
        calls.push({ workspaceId, options });
        return {
          files: [{ name: 'a.txt', type: 'file', path: 'a.txt', extension: '.txt' }],
          currentPath: 'sub',
          mode: 'browse',
          root: '/ws',
          isMain: true,
        };
      },
    });

    const response = await filesApp(application).request(
      '/api/workspaces/ws-1/files?path=sub&limit=10&showHidden=true&root=/ws',
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        workspaceId: 'ws-1',
        options: {
          path: 'sub',
          search: undefined,
          limit: 10,
          showHidden: true,
          root: '/ws',
          signal: expect.anything(),
        },
      },
    ]);
    const body = await response.json() as { mode: string; files: Array<{ name: string }> };
    expect(body.mode).toBe('browse');
    expect(body.files[0].name).toBe('a.txt');
  });

  test('maps workspace-not-found to the exact 404 body', async () => {
    const application = makeFilesApplication({
      list: async () => {
        throw new Error('Workspace not found');
      },
    });

    const response = await filesApp(application).request('/api/workspaces/missing/files');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'not_found',
      message: 'Workspace not found',
    });
  });

  test('maps preview containment to 403 and passes HttpErrors through', async () => {
    const application = makeFilesApplication({
      previewFile: async () => {
        throw new Error('Path outside workspace');
      },
    });

    const forbidden = await filesApp(application).request(
      '/api/workspaces/ws-1/file-preview?path=../secret.txt',
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: 'forbidden',
      message: 'Path outside workspace',
    });

    const conflictApp = makeFilesApplication({
      previewFile: async () => {
        throw new HttpError(409, 'conflict', 'conflict');
      },
    });
    const conflict = await filesApp(conflictApp).request(
      '/api/workspaces/ws-1/file-preview?path=x',
    );
    expect(conflict.status).toBe(409);
  });

  test('requires the path parameter on preview, file, and diff endpoints', async () => {
    const app = filesApp(makeFilesApplication());

    for (const endpoint of [
      '/api/workspaces/ws-1/file-preview',
      '/api/workspaces/ws-1/file',
      '/api/workspaces/ws-1/git/diff',
    ]) {
      const response = await app.request(endpoint);
      expect(response.status, endpoint).toBe(400);
      expect(await response.json(), endpoint).toEqual({
        error: 'bad_request',
        message: 'Path query parameter is required',
      });
    }
  });

  test('the tree endpoint delegates query options and returns paths', async () => {
    const calls: Array<unknown> = [];
    const application = makeFilesApplication({
      listTreePaths: async (workspaceId, input) => {
        calls.push({ workspaceId, input });
        return { root: '/ws', isMain: true, paths: ['a.txt'], truncated: true };
      },
    });

    const response = await filesApp(application).request(
      '/api/workspaces/ws-1/files/tree?root=/ws&showHidden=false',
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        workspaceId: 'ws-1',
        input: { root: '/ws', showHidden: false },
      },
    ]);
    expect(await response.json()).toEqual({
      root: '/ws',
      isMain: true,
      paths: ['a.txt'],
      truncated: true,
    });
  });

  test('the mutation endpoints delegate validated bodies verbatim', async () => {
    const calls: Array<{ op: string; body: unknown }> = [];
    const application = makeFilesApplication({
      createFileEntry: async (workspaceId, input) => {
        calls.push({ op: 'create', body: input });
        return { path: 'made.txt' };
      },
      renameFileEntry: async (workspaceId, input) => {
        calls.push({ op: 'rename', body: input });
        return { path: 'to.txt', from: 'from.txt' };
      },
      deleteFileEntry: async (workspaceId, input) => {
        calls.push({ op: 'delete', body: input });
        return { path: 'gone.txt', recursive: true };
      },
    });
    const app = filesApp(application);

    const created = await app.request('/api/workspaces/ws-1/files/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'dir/made.txt', kind: 'file' }),
    });
    expect(created.status).toBe(200);

    const renamed = await app.request('/api/workspaces/ws-1/files/rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'from.txt', to: 'to.txt' }),
    });
    expect(renamed.status).toBe(200);

    const deleted = await app.request('/api/workspaces/ws-1/files/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'gone.txt', recursive: true }),
    });
    expect(deleted.status).toBe(200);

    expect(calls).toEqual([
      { op: 'create', body: { path: 'dir/made.txt', kind: 'file' } },
      { op: 'rename', body: { from: 'from.txt', to: 'to.txt' } },
      { op: 'delete', body: { path: 'gone.txt', recursive: true } },
    ]);
  });

  test('mutation endpoints reject absolute paths at the schema boundary', async () => {
    const application = makeFilesApplication();
    const app = filesApp(application);

    for (const [endpoint, body] of [
      ['/files/create', JSON.stringify({ path: '/abs.txt' })],
      ['/files/create', JSON.stringify({ path: 'ok/../traversal.txt' })],
      ['/files/rename', JSON.stringify({ from: 'a.txt', to: '/b.txt' })],
      ['/files/delete', JSON.stringify({ path: '../escape.txt' })],
    ] as const) {
      const response = await app.request(`/api/workspaces/ws-1${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect(response.status, `${endpoint} ${body}`).toBe(400);
    }
  });

  test('the save endpoint delegates the validated body', async () => {
    const calls: Array<unknown> = [];
    const application = makeFilesApplication({
      saveFile: async (workspaceId, input) => {
        calls.push({ workspaceId, input });
        return {
          path: 'file.txt',
          revision: 'rev2',
          size: 5,
          modifiedAt: 'now',
        };
      },
    });

    const response = await filesApp(application).request('/api/workspaces/ws-1/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'file.txt',
        content: 'hello',
        expectedRevision: 'rev1',
      }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        workspaceId: 'ws-1',
        input: { path: 'file.txt', content: 'hello', expectedRevision: 'rev1' },
      },
    ]);
  });

  test('the git status endpoint returns the wire shape from the application', async () => {
    const application = makeFilesApplication({
      gitStatus: async () => ({
        availability: { available: true, root: '/ws' },
        files: [{ path: 'a.txt', git: { status: 'modified', staged: false, unstaged: true } }],
        root: '/ws',
      }),
    });

    const response = await filesApp(application).request('/api/workspaces/ws-1/git/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      availability: { available: true, root: '/ws' },
      files: [{ path: 'a.txt', git: { status: 'modified', staged: false, unstaged: true } }],
      root: '/ws',
    });
  });

  test('the home browse endpoint delegates listDirectoryOnly and maps failures to 400', async () => {
    const application = makeFilesApplication({
      listDirectoryOnly: async (dirPath) => {
        if (dirPath.includes('missing')) throw new Error('Cannot access path');
        return [{ name: 'home.txt', type: 'file', path: 'home.txt', extension: '.txt' }];
      },
    });

    const ok = await filesApp(application).request('/api/fs/browse?path=/tmp');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { files: Array<{ name: string }> }).files[0].name).toBe('home.txt');

    const failed = await filesApp(application).request('/api/fs/browse?path=/missing');
    expect(failed.status).toBe(400);
    expect(await failed.json()).toEqual({
      error: 'Bad Request',
      message: 'Cannot access path',
    });
  });

  test('the git diff endpoint delegates and returns the response', async () => {
    const application = makeFilesApplication({
      gitDiff: async () => ({
        path: 'file.txt',
        diffAvailable: true,
        status: { status: 'modified', staged: false, unstaged: true },
        hunks: [],
        additions: 2,
        deletions: 1,
        language: 'text',
      }),
    });

    const response = await filesApp(application).request(
      '/api/workspaces/ws-1/git/diff?path=file.txt',
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { additions: number }).additions).toBe(2);
  });

  test('unknown filesystem errors propagate to the exact 500 body', async () => {
    const application = makeFilesApplication({
      saveFile: async () => {
        throw new Error('EACCES: permission denied');
      },
    });

    const response = await filesApp(application).request('/api/workspaces/ws-1/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: 'file.txt',
        content: 'hello',
        expectedRevision: 'rev1',
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Internal Server Error',
      message: 'EACCES: permission denied',
      path: '/api/workspaces/ws-1/file',
      method: 'PUT',
    });
  });

  test('the browse endpoint expands ~-prefixed inputs through the path policy', async () => {
    const expansions: string[] = [];
    const listings: string[] = [];
    const application = makeFilesApplication({
      expandPathFor: (inputPath) => {
        expansions.push(inputPath);
        return resolve(inputPath);
      },
      listDirectoryOnly: async (dirPath) => {
        listings.push(dirPath);
        return [];
      },
    });

    await filesApp(application).request('/api/fs/browse?path=~user/file.txt');

    expect(expansions).toEqual(['~user/file.txt']);
    // The expanded value resolves verbatim against the process cwd, so the
    // final browse path is the cwd-anchored resolution, never a homedir
    // join.
    expect(listings).toEqual([resolve('~user/file.txt')]);
    expect(listings[0]).not.toBe(join(homedir(), '~user/file.txt'));
  });
});
