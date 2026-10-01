import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { HttpError } from '@/application/http-errors';
import { registerSessionRoutes } from '@/transport/http/routes/sessions';
import { createSessionHttpApplication, type SessionHttpApplication } from '@/application/sessions/http';
import { createHarnessSettingsApplication } from '@/application/harnesses/settings';
import type { HarnessSettingsRepository } from '@/application/ports/harness-settings';
import type { SessionRepositoryPort } from '@/application/ports/session';
import type { Session, ToolPart } from '@prokopai/sdk';

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
    getToolPart: () => null,
    reconcileCompaction: async () => 0,
    reconcileOrphanedToolCalls: () => 0,
    listQueuedMessages: () => [],
    addMessageToQueue: () => { throw new Error('not used'); },
    getQueuedMessage: () => null,
    deleteQueuedMessage: () => true,
    markManualSessionTitle: (metadata) => ({ ...(metadata ?? {}), titleManuallyRenamed: true }),
    getWorkspacePermissionMode: () => 'standard',
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

function makeApp(
  overrides: Partial<SessionRepositoryPort> = {},
  options: { codexAvailable?: boolean; codexWorkspaceAvailable?: (id: string) => boolean } = {},
): {
  app: Hono;
  application: SessionHttpApplication;
} {
  const application = createSessionHttpApplication(makeRepository(overrides), undefined, undefined, undefined,
    () => options.codexAvailable ?? false, options.codexWorkspaceAvailable ?? (() => false));
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
  test('grouped category filtering reaches the repository and rejects unknown categories', async () => {
    const calls: unknown[] = [];
    const { app } = makeApp({
      listSessionsGrouped: (_ids, options) => { calls.push(options); return {}; },
      listSessionPageGrouped: (_ids, options) => { calls.push(options); return { sessions: {}, pagination: {} }; },
    });
    expect((await app.request('/api/sessions/grouped?workspaceIds=ws-1&category=wrong')).status).toBe(400);
    expect(calls).toHaveLength(0);
    expect((await app.request('/api/sessions/grouped?workspaceIds=ws-1&category=active')).status).toBe(200);
    expect((await app.request('/api/sessions/grouped?workspaceIds=ws-1&category=active&limitPerWorkspace=50')).status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({ category: 'active' }),
      expect.objectContaining({ category: 'active', limitPerWorkspace: 50 }),
    ]);
  });

  test('GET /api/sessions returns the list with status filtering', async () => {
    const { app } = makeApp({
      listSessions: (status) => (status ? [makeSession({ status })] : []),
    });

    const res = await app.request('/api/sessions?status=closed');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ sessions: [expect.objectContaining({ status: 'closed' })] });
  });

  test('harness status exposes enablement and PUT validates ids, prokop, and payload shape', async () => {
    const stored: unknown[] = [];
    const settingsRepository: HarnessSettingsRepository = {
      read: () => stored.at(-1) ?? null,
      write: (settings) => { stored.push(settings); },
    };
    const application = createSessionHttpApplication(makeRepository(), undefined, undefined, undefined,
      () => true, () => true, undefined, () => true, undefined, () => true,
      {
        settings: createHarnessSettingsApplication(settingsRepository),
        codexVersion: () => 'codex-1.2.3',
        claudeVersion: () => { throw new Error('probe failed'); },
      });
    const app = new Hono();
    app.onError((err, c) => err instanceof HttpError
      ? c.json({ message: err.message }, err.status as never)
      : c.json({ message: 'unexpected error' }, 500));
    registerSessionRoutes(app, application);
    const put = (id: string, body: unknown) => app.request(`/api/harnesses/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    expect(await json(await app.request('/api/harnesses'))).toEqual({
      harnesses: [
        { id: 'prokop', available: true, enabled: true, version: null, approvals: true },
        { id: 'codex-cli', available: true, enabled: true, version: 'codex-1.2.3', approvals: false },
        { id: 'claude-cli', available: true, enabled: true, version: null, approvals: false },
      ],
    });
    const updated = await json(await put('codex-cli', { enabled: false }));
    expect(updated).toMatchObject({ harnesses: [
      expect.objectContaining({ id: 'prokop', enabled: true }),
      expect.objectContaining({ id: 'codex-cli', enabled: false }),
      expect.objectContaining({ id: 'claude-cli', enabled: true }),
    ] });
    expect((await put('prokop', { enabled: false })).status).toBe(400);
    expect((await put('unknown', { enabled: false })).status).toBe(404);
    expect((await put('codex-cli', {})).status).toBe(400);
    expect((await put('codex-cli', { enabled: 'yes' })).status).toBe(400);

    const created = await app.request('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harness: 'codex-cli', preconfigId: 'agent' }),
    });
    expect(created.status).toBe(400);
    expect(await json(created)).toMatchObject({ message: 'Codex CLI sessions are disabled on this server' });
  });

  test('Codex model selection validates host models, effort, session ownership and active turns', async () => {
    const saved: unknown[] = [];
    let active = false;
    const repository = makeRepository({ getSession: id => id === 'codex' ? makeSession({ id, harness: 'codex-cli' }) : null });
    const application = createSessionHttpApplication(repository, undefined, undefined, undefined,
      () => true, () => true, {
        list: async () => [{ model: 'codex-one', name: 'Codex One', supportedEfforts: ['low', 'medium'],
          defaultEffort: 'medium', isDefault: true }],
        get: () => (saved.at(-1) as { model: string; effort: string } | undefined) ?? null,
        save: (_id, selection) => { saved.push(selection); },
        isActive: () => active,
      });
    const app = new Hono();
    app.onError((err, c) => err instanceof HttpError
      ? c.json({ message: err.message }, err.status as never)
      : c.json({ message: 'unexpected error' }, 500));
    registerSessionRoutes(app, application);
    const put = (id: string, body: unknown) => app.request(`/api/sessions/${id}/codex-model`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(await json(await app.request('/api/harnesses/codex-cli/models')))
      .toEqual({ models: [expect.objectContaining({ model: 'codex-one' })] });
    expect((await app.request('/api/sessions/prokop/codex-models')).status).toBe(404);
    expect(await json(await app.request('/api/sessions/codex/codex-models')))
      .toEqual({ models: [expect.objectContaining({ model: 'codex-one' })], selection: null });
    expect((await put('codex', { model: 'codex-one', effort: 'xhigh' })).status).toBe(400);
    expect((await put('codex', { model: 'other', effort: 'low' })).status).toBe(400);
    expect((await put('codex', { model: 'codex-one', effort: 'low', ignored: true })).status).toBe(400);
    expect((await put('prokop', { model: 'codex-one', effort: 'low' })).status).toBe(404);
    active = true;
    expect((await put('codex', { model: 'codex-one', effort: 'low' })).status).toBe(400);
    active = false;
    expect((await put('codex', { model: 'codex-one', effort: 'low' })).status).toBe(200);
    expect(saved).toEqual([{ model: 'codex-one', effort: 'low' }]);
  });

  test('Claude catalog and effort selection reject wrong owners, invalid values and active turns', async () => {
    let active = false;
    const saved: unknown[] = [];
    const application = createSessionHttpApplication(makeRepository({
      getSession: id => id === 'claude' ? makeSession({ id, harness: 'claude-cli' }) : null,
    }), undefined, undefined, undefined, () => false, () => false, undefined,
    () => true, { list: async () => [{ model: 'sonnet', name: 'Sonnet', supportedEfforts: ['low', 'high'],
      defaultEffort: 'high', isDefault: true }], get: () => null,
    save: (_id, selection) => { saved.push(selection); }, isActive: () => active });
    const app = new Hono();
    app.onError((err, c) => err instanceof HttpError
      ? c.json({ message: err.message }, err.status as never) : c.json({ message: 'error' }, 500));
    registerSessionRoutes(app, application);
    expect((await app.request('/api/harnesses/claude-cli/models')).status).toBe(200);
    expect((await app.request('/api/sessions/claude/claude-models')).status).toBe(200);
    const put = (id: string, body: unknown) => app.request(`/api/sessions/${id}/claude-model`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await put('other', { model: 'sonnet', effort: 'high' })).status).toBe(404);
    expect((await put('claude', { model: 'opus', effort: 'high' })).status).toBe(400);
    expect((await put('claude', { model: 'sonnet', effort: 'medium' })).status).toBe(400);
    active = true;
    expect((await put('claude', { model: 'sonnet', effort: 'low' })).status).toBe(400);
    active = false;
    expect((await put('claude', { model: 'sonnet', effort: 'low' })).status).toBe(200);
    expect(saved).toEqual([{ model: 'sonnet', effort: 'low' }]);
    const failed = createSessionHttpApplication(makeRepository({
      getSession: () => makeSession({ harness: 'claude-cli' }),
    }), undefined, undefined, undefined, () => false, () => false, undefined,
    () => true, { list: async () => { throw new Error('probe failed'); }, get: () => null,
      save: () => {}, isActive: () => false });
    const failedApp = new Hono();
    failedApp.onError((err, c) => err instanceof HttpError
      ? c.json({ message: err.message }, err.status as never) : c.json({ message: 'error' }, 500));
    registerSessionRoutes(failedApp, failed);
    expect((await failedApp.request('/api/harnesses/claude-cli/models')).status).toBe(400);
    expect((await failedApp.request('/api/sessions/claude/claude-models')).status).toBe(400);
    expect((await failedApp.request('/api/sessions/claude/claude-model', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sonnet', effort: 'high' }),
    })).status).toBe(400);
  });

  test('catalog is unavailable when the host has no Codex CLI', async () => {
    const { app } = makeApp();
    expect((await app.request('/api/harnesses/codex-cli/models')).status).toBe(400);
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

  test('POST /api/sessions fails closed for unavailable or unknown harnesses', async () => {
    const { app } = makeApp({ createSession: () => { throw new Error('must not create'); } });
    for (const harness of ['codex-cli', 'invalid', null]) {
      const res = await app.request('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness }),
      });
      expect(res.status).toBe(400);
    }
  });

  test('POST /api/sessions reports the policy rejection before creating', async () => {
    const { app } = makeApp({ createSession: () => { throw new Error('must not create'); } },
      { codexAvailable: true, codexWorkspaceAvailable: () => false });
    const res = await app.request('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harness: 'codex-cli', workspaceId: 'virtual' }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_request',
      message: 'Codex CLI requires a physical workspace' });
  });

  test('POST /api/sessions does not misreport an application refusal as a worktree error', async () => {
    const { app, application } = makeApp();
    application.createSession = () => null;
    const res = await app.request('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ harness: 'prokop' }),
    });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: 'bad_request', message: 'Session could not be created' });
  });

  test('POST /api/sessions accepts a Codex preconfig only in a physical workspace', async () => {
    const created: unknown[] = [];
    const { app } = makeApp({
      createSession: input => { created.push(input); return makeSession({ harness: input.harness }); },
    }, { codexAvailable: true, codexWorkspaceAvailable: id => id === 'physical' });
    const post = (body: unknown) => app.request('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    for (const body of [
      { harness: 'codex-cli', workspaceId: 'virtual' },
      { harness: '__proto__', workspaceId: 'physical' },
    ]) expect((await post(body)).status).toBe(400);
    expect(created).toHaveLength(0);
    expect((await post({ harness: 'codex-cli', workspaceId: 'physical' })).status).toBe(400);
    expect((await post({ harness: 'codex-cli', workspaceId: 'physical', preconfigId: 'prokop-agent' })).status).toBe(201);
    expect(created).toEqual([expect.objectContaining({ harness: 'codex-cli', preconfigId: 'prokop-agent' })]);
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

  test('GET tool debug returns raw fields only for a part in the requested session', async () => {
    const part: ToolPart = {
      id: 'part-1',
      messageId: 'message-1',
      createdAt: 1,
      type: 'tool',
      callId: 'call-1',
      name: 'shell',
      state: {
        status: 'completed',
        input: { command: 'pwd' },
        output: { success: true },
        startedAt: 1,
        completedAt: 2,
      },
    };
    const { app } = makeApp({
      getToolPart: (sessionId, partId) =>
        sessionId === 'sess-1' && partId === 'part-1' ? part : null,
    });

    const ok = await app.request('/api/sessions/sess-1/tool-parts/part-1/debug');
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({
      input: { command: 'pwd' },
      output: { success: true },
    });

    const crossSession = await app.request('/api/sessions/other/tool-parts/part-1/debug');
    expect(crossSession.status).toBe(404);
    expect(await json(crossSession)).toEqual({ error: 'not_found', message: 'Tool part not found' });
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
