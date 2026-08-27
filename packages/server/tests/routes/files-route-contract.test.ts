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
