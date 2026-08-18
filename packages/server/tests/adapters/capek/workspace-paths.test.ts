import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import { homedir, tmpdir } from 'os';
import { Hono } from 'hono';
import { createWorkspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createFilesApplication } from '@/application/files';
import { createJean2FilesApplicationPort } from '@/adapters/jean2/files';
import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createFilePreview } from '@/infrastructure/filesystem/file-preview';

const getFilePreview = createFilePreview(workspacePathPolicyPort);
import { registerFileRoutes } from '@/routes/files';
import { HttpError } from '@/application/http-errors';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import type { WorkspacePathPolicyPort } from '@/application/ports/workspace-paths';

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

function port(): WorkspacePathPolicyPort {
  return createWorkspacePathPolicyPort();
}

function textContent(preview: Awaited<ReturnType<typeof getFilePreview>>): string {
  if ('content' in preview) return preview.content;
  throw new Error(`expected text preview, got kind ${preview.kind}`);
}

// The exact pre-C6 containment matrix, formerly pinned against the server
// workspace domain and now resolved through the Capek workspace policy via
// the path policy adapter.
describe('workspace path policy adapter (C6 step 4)', () => {
  test('expandPath expands home paths and resolves', () => {
    const policy = port();
    expect(policy.expandPath('~/notes')).toBe(join(homedir(), 'notes'));
    expect(policy.expandPath('/abs/path')).toBe('/abs/path');
    expect(policy.expandPath('relative')).toBe(join(process.cwd(), 'relative'));
  });

  test('retains the optional home override of the retired server signature', () => {
    const policy = port();
    expect(policy.expandPath('~/notes', '/home/override')).toBe('/home/override/notes');
    expect(policy.expandPath('/abs/path', '/home/override')).toBe('/abs/path');
    expect(policy.resolvePath('~/x', '/ws', '/home/override')).toBe('/home/override/x');
    expect(policy.resolvePath('/abs', '/ws', '/home/override')).toBe('/abs');
    expect(policy.resolvePath('rel', '/ws', '/home/override')).toBe(resolve('/ws', 'rel'));
    // Without the override the active home applies, exactly like before.
    expect(policy.expandPath('~/x')).toBe(join(homedir(), 'x'));
  });

  test('isPathWithinWorkspace preserves the containment matrix', () => {
    const policy = port();
    expect(policy.isPathWithinWorkspace('/main/sub', '/main')).toBe(true);
    expect(policy.isPathWithinWorkspace('/main', '/main')).toBe(true);
    // Separator-aware: /main-other must not match /main.
    expect(policy.isPathWithinWorkspace('/main-other/x', '/main')).toBe(false);
    expect(policy.isPathWithinWorkspace('/outside', '/main')).toBe(false);
    expect(policy.isPathWithinWorkspace('../escape', '/main')).toBe(false);
    expect(policy.isPathWithinWorkspace('/extra/sub', '/main', ['/extra'])).toBe(true);
    expect(policy.isPathWithinWorkspace('/other', '/main', ['/extra'])).toBe(false);
    // Legitimate inside-root traversal stays allowed when the containing
    // root is a declared additional root.
    expect(policy.isPathWithinWorkspace('/main/notes.txt', '/main/sub', ['/main'])).toBe(true);
  });

  test('isPathInside is separator-aware and covers the root', () => {
    const policy = port();
    expect(policy.isPathInside('/foo/bar', '/foo')).toBe(true);
    expect(policy.isPathInside('/foo', '/foo')).toBe(true);
    expect(policy.isPathInside('/foobar', '/foo')).toBe(false);
    expect(policy.isPathInside('/anything', '/')).toBe(true);
  });

  test('unselected additional roots are detected exactly', () => {
    const policy = port();
    expect(policy.isInsideUnselectedAdditionalRoot('/extra/x', '/main', ['/extra'])).toBe(true);
    expect(policy.isInsideUnselectedAdditionalRoot('/extra/x', '/extra', ['/extra'])).toBe(false);
    expect(policy.isInsideUnselectedAdditionalRoot('/main/x', '/main', ['/extra'])).toBe(false);
  });

  test('resolveCandidatePath anchors relative inputs and passes absolutes through', () => {
    const policy = port();
    expect(policy.resolveCandidatePath('/root', 'sub/file.ts')).toBe('/root/sub/file.ts');
    expect(policy.resolveCandidatePath('/root', '/abs/file.ts')).toBe('/abs/file.ts');
    expect(policy.resolveCandidatePath('/root', 'sub\\win.ts')).toBe('/root/sub/win.ts');
  });

  test('resolveRootForQuery falls back to the main root for missing or invalid roots', () => {
    const policy = port();
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(policy.resolveRootForQuery(workspace)).toEqual({ root: '/main', isMain: true });
    expect(policy.resolveRootForQuery(workspace, '/extra')).toEqual({ root: '/extra', isMain: false });
    expect(policy.resolveRootForQuery(workspace, '/main')).toEqual({ root: '/main', isMain: true });
    expect(policy.resolveRootForQuery(workspace, '/other')).toEqual({ root: '/main', isMain: true });
  });

  test('selectEditableRoot rejects roots outside the workspace and additional roots', () => {
    const policy = port();
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(policy.selectEditableRoot(workspace)).toEqual({ root: '/main', valid: true });
    expect(policy.selectEditableRoot(workspace, '/extra')).toEqual({ root: '/extra', valid: true });
    expect(policy.selectEditableRoot(workspace, '/other').valid).toBe(false);
  });
});

describe('file preview containment matrix (C6 step 4)', () => {
  test('denies a sibling-prefix path when it is not a declared additional root', async () => {
    const base = tempRoot('capek-matrix-base');
    const main = join(base, 'main');
    const sibling = `${main}-other`;
    mkdirSync(main);
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'sibling content');

    // Absolute input resolving to the sibling prefix: denied.
    await expect(getFilePreview(main, join(sibling, 'secret.txt'), []))
      .rejects.toThrow('Path outside workspace');
    // Relative input anchors inside the main root (legitimate behavior), so
    // the sibling basename resolves to a missing file inside the root.
    await expect(getFilePreview(main, `${basename(sibling)}/secret.txt`, []))
      .rejects.toThrow('File not found');
  });

  test('allows the same sibling path when it is explicitly declared as an additional root', async () => {
    const main = tempRoot('capek-matrix-main');
    const sibling = tempRoot('capek-matrix-sibling');
    writeFileSync(join(sibling, 'shared.txt'), 'shared content');

    await expect(getFilePreview(main, join(sibling, 'shared.txt'), []))
      .rejects.toThrow('Path outside workspace');

    const preview = await getFilePreview(main, join(sibling, 'shared.txt'), [sibling]);
    expect(preview).toMatchObject({ name: 'shared.txt', kind: 'text', readOnly: true });
    expect(textContent(preview)).toBe('shared content');
  });

  test('denies traversal that resolves outside the declared roots', async () => {
    const base = tempRoot('capek-matrix-escape');
    const main = join(base, 'main');
    const outside = join(base, 'escape');
    mkdirSync(main);
    mkdirSync(outside);
    writeFileSync(join(outside, 'outside.txt'), 'outside content');

    await expect(getFilePreview(main, '../escape/outside.txt', []))
      .rejects.toThrow('Path outside workspace');
  });

  test('allows traversal that lexically resolves back inside the workspace root', async () => {
    const main = tempRoot('capek-matrix-inside');
    mkdirSync(join(main, 'sub'), { recursive: true });
    writeFileSync(join(main, 'notes.txt'), 'inside content');

    const preview = await getFilePreview(main, 'sub/../notes.txt', []);
    expect(preview).toMatchObject({ name: 'notes.txt', kind: 'text', readOnly: true });
    expect(textContent(preview)).toBe('inside content');
  });
});

describe('file preview route containment status (C6 step 4)', () => {
  let workspaceId: string;
  let main: string;

  beforeEach(() => {
    setupTestDatabase();
    main = tempRoot('capek-route-main');
    workspaceId = seedWorkspace({ id: 'ws-route', path: main }).id;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function filesApp(): Hono {
    const app = new Hono();
    const files = createFilesApplication(createJean2FilesApplicationPort());
    registerFileRoutes(app, files);
    // The production app.ts onError mapping: HttpError carries the exact
    // status and body shape the client sees.
    app.onError((err, c) => {
      if (err instanceof HttpError) {
        const body: Record<string, unknown> = {
          error: err.code,
          message: err.message,
        };
        if (err.details !== undefined) body.details = err.details;
        return c.json(body, err.status as never);
      }
      return c.json({ error: 'internal', message: err.message }, 500 as never);
    });
    return app;
  }

  test('maps sibling-prefix escapes to 403 with the exact body', async () => {
    const sibling = `${main}-other`;
    mkdirSync(sibling);
    writeFileSync(join(sibling, 'secret.txt'), 'sibling content');

    const response = await filesApp().request(
      `/api/workspaces/${workspaceId}/file-preview`
      + `?path=${encodeURIComponent(`../${basename(sibling)}/secret.txt`)}`,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden',
      message: 'Path outside workspace',
    });
  });

  test('keeps inside-root traversal allowed at the route boundary', async () => {
    mkdirSync(join(main, 'sub'), { recursive: true });
    writeFileSync(join(main, 'notes.txt'), 'inside content');

    const response = await filesApp().request(
      `/api/workspaces/${workspaceId}/file-preview`
      + `?path=${encodeURIComponent('sub/../notes.txt')}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { name: string; kind: string; content: string };
    expect(body).toMatchObject({ name: 'notes.txt', kind: 'text' });
    expect(body.content).toBe('inside content');
  });
});
