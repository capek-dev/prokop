/**
 * Files route (S5 filesystem isolation). Invokes only the files application
 * use cases plus presentation validation and HTTP errors. No store,
 * service, or path-utils imports remain; the route's legacy exceptions are
 * retired with AST gates.
 */

import type { Hono } from 'hono';
import { accessSync, constants } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { homedir } from 'os';
import type { FilesApplication } from '@/application/files';
import { validate } from './validate';
import { saveFileSchema } from './schemas';
import type { SaveFileRequest } from '@jean2/sdk';

import { BadRequestError, ForbiddenError, HttpError, NotFoundError } from '@/utils/http-errors';

/** Maps the application/infrastructure plain errors and passes everything
 * else through, preserving the exact pre-slice status codes and messages.
 * Known sentinel messages keep their mappings; unknown errors propagate to
 * the Hono 500 path instead of being converted to a not-found. */
function mapApplicationError(err: unknown): never {
  if (err instanceof HttpError) {
    throw err;
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (message === 'Workspace not found' || message === 'Path not found') {
    throw new NotFoundError(message);
  }
  if (message === 'Cannot preview a directory') {
    throw new BadRequestError(message);
  }
  if (message === 'Path outside workspace') {
    throw new ForbiddenError(message);
  }
  throw err;
}

export function registerFileRoutes(app: Hono, files: FilesApplication): void {
  app.get('/api/workspaces/:id/files', async (c) => {
    const workspaceId = c.req.param('id');
    const path = c.req.query('path') || '';
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const showHidden = c.req.query('showHidden') !== 'false';
    const rootQuery = c.req.query('root');

    try {
      const result = await files.list(workspaceId, {
        path,
        search,
        limit,
        showHidden,
        root: rootQuery,
        signal: c.req.raw.signal,
      });

      if (search && c.req.raw.signal.aborted) {
        return new Response(null, { status: 499 });
      }

      return c.json(result);
    } catch (err) {
      mapApplicationError(err);
    }
  });

  app.get('/api/workspaces/:id/git/status', async (c) => {
    const workspaceId = c.req.param('id');
    const rootQuery = c.req.query('root');

    try {
      const status = await files.gitStatus(workspaceId, rootQuery);
      return c.json(status);
    } catch (err) {
      mapApplicationError(err);
    }
  });

  app.get('/api/workspaces/:id/file-preview', async (c) => {
    const workspaceId = c.req.param('id');
    const path = c.req.query('path');
    const rootQuery = c.req.query('root');

    if (!path) {
      throw new BadRequestError('Path query parameter is required');
    }

    try {
      const preview = await files.previewFile(workspaceId, path, rootQuery);
      return c.json(preview);
    } catch (err: unknown) {
      mapApplicationError(err);
    }
  });

  app.get('/api/workspaces/:id/file', async (c) => {
    const workspaceId = c.req.param('id');
    const path = c.req.query('path');
    const rootQuery = c.req.query('root');

    if (!path) {
      throw new BadRequestError('Path query parameter is required');
    }

    try {
      const file = await files.readEditableFile(workspaceId, path, rootQuery);
      return c.json(file);
    } catch (err) {
      mapApplicationError(err);
    }
  });

  app.put(
    '/api/workspaces/:id/file',
    validate('json', saveFileSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const body = c.req.valid('json') as SaveFileRequest;

      try {
        const result = await files.saveFile(workspaceId, body);
        return c.json(result);
      } catch (err) {
        mapApplicationError(err);
      }
    },
  );

  app.get('/api/workspaces/:id/git/diff', async (c) => {
    const workspaceId = c.req.param('id');
    const path = c.req.query('path');
    const rootQuery = c.req.query('root');

    if (!path) {
      throw new BadRequestError('Path query parameter is required');
    }

    try {
      const diff = await files.gitDiff(workspaceId, path, rootQuery);
      return c.json(diff);
    } catch (err) {
      mapApplicationError(err);
    }
  });

  app.get('/api/fs/browse', async (c) => {
    // When no path is provided (or it's empty), default to home directory.
    const path = c.req.query('path') || homedir();
    // Expand ~ through the C6 workspace path policy and resolve to absolute.
    // Relative paths and `~user`-style inputs anchor exactly like the
    // pre-slice browse helper (relative joins homedir, `~user` resolves
    // against the process cwd).
    const expanded = path.startsWith('~')
      ? files.expandPathFor(path)
      : path;
    const resolvedPath = resolve(isAbsolute(expanded) ? expanded : join(homedir(), expanded));
    const isRoot = resolvedPath === dirname(resolvedPath);

    try {
      const listed = await files.listDirectoryOnly(resolvedPath);
      return c.json({ files: listed, currentPath: resolvedPath, mode: 'browse', isRoot });
    } catch (_err: unknown) {
      return c.json({ error: 'Bad Request', message: 'Cannot access path' }, 400);
    }
  });

  app.get('/api/fs/parent', async (c) => {
    const inputPath = c.req.query('path') || homedir();
    // Resolve relative paths against homedir (not process.cwd()) for
    // consistency with /api/fs/browse defaults.
    const resolvedInput = isAbsolute(inputPath) ? inputPath : join(homedir(), inputPath);
    const resolvedPath = resolve(resolvedInput);
    const parent = dirname(resolvedPath);
    const isRoot = resolvedPath === parent;

    try {
      const listed = await files.listDirectoryOnly(parent);
      return c.json({ files: listed, currentPath: resolve(parent), mode: 'browse', isRoot });
    } catch (_err: unknown) {
      return c.json({ error: 'Bad Request', message: 'Cannot access path' }, 400);
    }
  });

  app.get('/api/fs/drives', async (c) => {
    const platform = process.platform;

    if (platform === 'win32') {
      const drives: string[] = [];
      for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        try {
          accessSync(`${letter}:\\`, constants.R_OK);
          drives.push(`${letter}:\\`);
        } catch {
          // Drive not available, skip
        }
      }
      return c.json({ drives });
    }

    return c.json({ drives: ['/'] });
  });
}
