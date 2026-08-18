import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { HttpError } from '@/application/http-errors';
import { registerSessionRoutes } from '@/transport/http/routes/sessions';
import { createSessionHttpApplication, type SessionHttpApplication } from '@/application/sessions/http';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { Session } from '@jean2/sdk';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: 'New Session',
    status: 'active',
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Session;
}

function makeRepository(overrides: Partial<SessionRepositoryPort> = {}): SessionRepositoryPort {
  return {
    createSession: () => makeSession(),
    getSession: () => makeSession(),
    updateSession: () => makeSession(),
    deleteSession: () => true,
    listSessions: () => [],
    listSessionsByWorkspace: () => [],
    listSessionsByAgent: () => [],
    listSessionsGrouped: () => ({}),
    listSessionPageGrouped: () => ({ sessions: {}, pagination: {} }),
    listTagsByWorkspace: () => [],
    listMessages: () => [],
    listLatestMessagesWithPartsPage: () => ({ messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } }),
    listMessagesWithPartsBeforeSequence: () => ({ messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } }),
    reconcileCompaction: () => 0,
    reconcileOrphanedToolCalls: () => 0,
    listQueuedMessages: () => [],
    addMessageToQueue: () => { throw new Error('not used'); },
    getQueuedMessage: () => null,
    deleteQueuedMessage: () => true,
    markManualSessionTitle: (metadata) => ({ ...(metadata ?? {}), titleManuallyRenamed: true }),
    getWorkspaceAutoApproveSeverity: () => 'low',
    getPreconfigOrAgent: async () => null,
    isAgentSync: () => false,
    toolOutput: {
      defaultPageChars: 10_000,
      maxPageChars: 20_000,
      isArtifactId: () => true,
      getPage: () => null,
    },
    attachments: {
      maxSize: 20 * 1024 * 1024,
      determineKind: () => 'file',
      validateImageMime: () => true,
      getByKey: () => null,
      listForSession: () => [],
      create: () => ({
        id: 'att-1',
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        kind: 'file',
        filename: 'f.txt',
        mimeType: 'text/plain',
        sizeBytes: 3,
        absolutePath: '/tmp/f',
        createdAt: new Date().toISOString(),
        accessKey: 'secret-key',
      }),
      readFileBuffer: () => Buffer.from('abc'),
    },
    ...overrides,
  };
}

function makeApp(overrides: Partial<SessionRepositoryPort> = {}): {
  app: Hono;
  application: SessionHttpApplication;
} {
  const application = createSessionHttpApplication(makeRepository(overrides));
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.code, message: err.message }, err.status as never);
    }
    return c.json({ error: 'Internal Server Error', message: String(err) }, 500 as never);
  });
  registerSessionRoutes(app, application);
  return { app, application };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

describe('HTTP session route contract', () => {
  test('GET /api/sessions returns the list with status filtering', async () => {
    const { app } = makeApp({
      listSessions: (status) => (status ? [makeSession({ status })] : []),
    });

    const res = await app.request('/api/sessions?status=closed');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ sessions: [expect.objectContaining({ status: 'closed' })] });
  });

  test('POST /api/sessions creates with 201 and keeps the HTTP defaults', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'From HTTP' }),
    });

    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({ session: expect.objectContaining({ title: 'New Session' }) });
  });

  test('GET /api/sessions/grouped validates the workspaceIds parameter', async () => {
    const { app } = makeApp();

    const missing = await app.request('/api/sessions/grouped');
    expect(missing.status).toBe(400);
    expect(await json(missing)).toEqual({ error: 'bad_request', message: 'workspaceIds query parameter is required' });

    const empty = await app.request('/api/sessions/grouped?workspaceIds=,');
    expect(empty.status).toBe(400);
    expect(await json(empty)).toEqual({ error: 'bad_request', message: 'At least one workspaceId is required' });

    const badLimit = await app.request('/api/sessions/grouped?workspaceIds=ws&limitPerWorkspace=0');
    expect(badLimit.status).toBe(400);
    expect(await json(badLimit)).toEqual({ error: 'bad_request', message: 'limitPerWorkspace must be an integer between 1 and 100' });
  });

  test('GET /api/sessions/tags requires a workspaceId', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/sessions/tags');
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_request', message: 'workspaceId query parameter is required' });
  });

  test('GET /api/sessions/:id maps a missing session to the exact 404 body', async () => {
    const { app } = makeApp({ getSession: () => null });
    const res = await app.request('/api/sessions/missing');
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found', message: 'Session not found' });
  });

  test('PUT /api/sessions/:id keeps the manual-title semantics through the use case', async () => {
    const updateInputs: unknown[] = [];
    const { app } = makeApp({
      getSession: () => makeSession({ metadata: { old: true } }),
      updateSession: (_id, updates) => {
        updateInputs.push(updates);
        return makeSession();
      },
    });

    const res = await app.request('/api/sessions/sess-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Manual' }),
    });
    expect(res.status).toBe(200);
    expect(updateInputs).toEqual([expect.objectContaining({
      title: 'Manual',
      metadata: { old: true, titleManuallyRenamed: true },
    })]);

    const missingApp = makeApp({ getSession: () => makeSession(), updateSession: () => null }).app;
    const missing = await missingApp.request('/api/sessions/missing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Manual' }),
    });
    expect(missing.status).toBe(404);
  });

  test('DELETE /api/sessions/:id returns success or the exact 404', async () => {
    const { app } = makeApp();
    const ok = await app.request('/api/sessions/sess-1', { method: 'DELETE' });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ success: true });

    const missingApp = makeApp({ deleteSession: () => false }).app;
    const missing = await missingApp.request('/api/sessions/sess-1', { method: 'DELETE' });
    expect(missing.status).toBe(404);
    expect(await json(missing)).toEqual({ error: 'not_found', message: 'Session not found' });
  });

  test('GET /api/sessions/:id/transcript validates limit and before', async () => {
    const { app } = makeApp();

    const badLimit = await app.request('/api/sessions/sess-1/transcript?limit=0');
    expect(badLimit.status).toBe(400);
    expect(await json(badLimit)).toEqual({ error: 'bad_request', message: 'limit must be an integer between 1 and 100' });

    const badBefore = await app.request('/api/sessions/sess-1/transcript?before=-1');
    expect(badBefore.status).toBe(400);
    expect(await json(badBefore)).toEqual({ error: 'bad_request', message: 'before must be a positive integer' });

    const ok = await app.request('/api/sessions/sess-1/transcript');
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } });
  });

  test('GET tool output artifacts validates the artifact id and the page limits', async () => {
    const { app } = makeApp({
      toolOutput: {
        defaultPageChars: 10,
        maxPageChars: 20,
        isArtifactId: () => false,
        getPage: () => null,
      },
    });

    const badId = await app.request('/api/sessions/sess-1/tool-output-artifacts/nope');
    expect(badId.status).toBe(400);
    expect(await json(badId)).toEqual({ error: 'bad_request', message: 'artifactId must be a UUID' });

    const validIdApp = makeApp({
      toolOutput: {
        defaultPageChars: 10,
        maxPageChars: 20,
        isArtifactId: () => true,
        getPage: () => null,
      },
    }).app;
    const badLimit = await validIdApp.request('/api/sessions/sess-1/tool-output-artifacts/art-1?limit=21');
    expect(badLimit.status).toBe(400);
    expect(await json(badLimit)).toEqual({ error: 'bad_request', message: 'limit must be an integer between 1 and 20' });

    const missingPage = await validIdApp.request('/api/sessions/sess-1/tool-output-artifacts/art-1');
    expect(missingPage.status).toBe(404);
    expect(await json(missingPage)).toEqual({ error: 'not_found', message: 'Tool output artifact not found' });
  });

  test('POST attachments rejects missing files with the exact body', async () => {
    const { app } = makeApp();

    const form = new FormData();
    const res = await app.request('/api/sessions/sess-1/attachments', { method: 'POST', body: form });

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_request', message: 'No file provided. Use multipart/form-data with field name "file".' });
  });

  test('POST attachments rejects oversized files with 413 and empty files with 400', async () => {
    const { app } = makeApp({
      attachments: {
        ...makeRepository().attachments,
        maxSize: 2,
      },
    });

    const tooLarge = new FormData();
    tooLarge.append('file', new File([new Uint8Array([1, 2, 3])], 'big.bin', { type: 'application/octet-stream' }));
    const largeRes = await app.request('/api/sessions/sess-1/attachments', { method: 'POST', body: tooLarge });
    expect(largeRes.status).toBe(413);
    expect(await json(largeRes)).toEqual({ error: 'payload_too_large', message: 'File size (0 MB) exceeds the 20 MB limit.' });

    const empty = new FormData();
    empty.append('file', new File([], 'empty.bin', { type: 'application/octet-stream' }));
    const emptyRes = await app.request('/api/sessions/sess-1/attachments', { method: 'POST', body: empty });
    expect(emptyRes.status).toBe(400);
    expect(await json(emptyRes)).toEqual({ error: 'bad_request', message: 'File is empty.' });
  });

  test('POST attachments rejects unsupported image types with the exact body', async () => {
    const { app } = makeApp({
      attachments: {
        ...makeRepository().attachments,
        determineKind: () => 'image',
        validateImageMime: () => false,
      },
    });

    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'img.svg', { type: 'image/svg+xml' }));
    const res = await app.request('/api/sessions/sess-1/attachments', { method: 'POST', body: form });

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_request', message: 'Image type "image/svg+xml" is not supported. Allowed: png, jpeg, webp, gif.' });
  });

  test('POST attachments returns the created attachment with its access key url', async () => {
    const { app } = makeApp();

    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'f.txt', { type: 'text/plain' }));
    const res = await app.request('/api/sessions/sess-1/attachments', { method: 'POST', body: form });

    expect(res.status).toBe(201);
    expect(await json(res)).toEqual({
      id: 'att-1',
      kind: 'file',
      filename: 'f.txt',
      mimeType: 'text/plain',
      size: 3,
      url: '/api/sessions/sess-1/attachments/att-1/content?key=secret-key',
    });
  });

  test('GET attachment content maps missing keys, mismatches, and missing files exactly', async () => {
    const noKeyApp = makeApp().app;
    const noKey = await noKeyApp.request('/api/sessions/sess-1/attachments/att-1/content');
    expect(noKey.status).toBe(401);
    expect(await json(noKey)).toEqual({ error: 'unauthorized', message: 'Missing access key' });

    const unknownApp = makeApp({
      attachments: { ...makeRepository().attachments, getByKey: () => null },
    }).app;
    const unknown = await unknownApp.request('/api/sessions/sess-1/attachments/att-1/content?key=k');
    expect(unknown.status).toBe(404);
    expect(await json(unknown)).toEqual({ error: 'not_found', message: 'Attachment not found' });

    const mismatchApp = makeApp({
      attachments: {
        ...makeRepository().attachments,
        getByKey: () => ({
          id: 'att-1',
          sessionId: 'other',
          workspaceId: 'ws',
          kind: 'file',
          filename: 'f',
          mimeType: 'text/plain',
          sizeBytes: 1,
          absolutePath: '/tmp/f',
          createdAt: new Date().toISOString(),
          accessKey: 'k',
        }),
      },
    }).app;
    const mismatch = await mismatchApp.request('/api/sessions/sess-1/attachments/att-1/content?key=k');
    expect(mismatch.status).toBe(403);
    expect(await json(mismatch)).toEqual({ error: 'forbidden', message: 'Session mismatch' });

    const missingFileApp = makeApp({
      attachments: {
        ...makeRepository().attachments,
        getByKey: () => ({
          id: 'att-1',
          sessionId: 'sess-1',
          workspaceId: 'ws',
          kind: 'file',
          filename: 'f',
          mimeType: 'text/plain',
          sizeBytes: 1,
          absolutePath: '/tmp/f',
          createdAt: new Date().toISOString(),
          accessKey: 'k',
        }),
        readFileBuffer: () => null,
      },
    }).app;
    const missingFile = await missingFileApp.request('/api/sessions/sess-1/attachments/att-1/content?key=k');
    expect(missingFile.status).toBe(404);
    expect(await json(missingFile)).toEqual({ error: 'not_found', message: 'Attachment file not found on disk' });
  });

  test('GET attachment content streams the file buffer with the exact headers', async () => {
    const { app } = makeApp({
      attachments: {
        ...makeRepository().attachments,
        getByKey: () => ({ ...makeRepository().attachments.create({ sessionId: 'sess-1', workspaceId: 'ws', filename: 'f', mimeType: 'text/plain', sizeBytes: 3, data: new ArrayBuffer(0) }) }),
        readFileBuffer: () => Buffer.from('abc'),
      },
    });

    const res = await app.request('/api/sessions/sess-1/attachments/att-1/content?key=k');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/plain');
    expect(res.headers.get('Content-Length')).toBe('3');
    expect(await res.text()).toBe('abc');
  });
});
