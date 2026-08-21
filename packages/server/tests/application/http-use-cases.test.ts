import { describe, expect, test } from 'bun:test';
import type { Session } from '@prokopai/sdk';
import { createSessionHttpApplication } from '@/application/sessions/http';
import type { SessionRepositoryPort, TranscriptPage } from '@/application/ports/session';

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
    reconcileCompaction: async () => 0,
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
      maxSize: 1000,
      determineKind: () => 'file',
      validateImageMime: () => true,
      getByKey: () => null,
      listForSession: () => [],
      create: () => ({ id: 'att-1', sessionId: 'sess-1', workspaceId: 'ws-1', kind: 'file', filename: 'f.txt', mimeType: 'text/plain', sizeBytes: 3, absolutePath: '/tmp/f', createdAt: new Date().toISOString(), accessKey: 'k' }),
      readFileBuffer: () => Buffer.from('abc'),
    },
    ...overrides,
  };
}

describe('session HTTP application', () => {
  test('createSession keeps the HTTP divergence: no auto-approve severity is passed', () => {
    const createInputs: unknown[] = [];
    const session = makeSession({ id: 'http-1' });
    const repository = makeRepository({
      createSession: (input) => {
        createInputs.push(input);
        return session;
      },
    });
    const app = createSessionHttpApplication(repository);

    const created = app.createSession({ workspaceId: 'ws-9', title: 'From HTTP', metadata: { m: 1 } });

    expect(created).toBe(session);
    expect(createInputs).toEqual([{
      id: expect.any(String),
      workspaceId: 'ws-9',
      preconfigId: null,
      title: 'From HTTP',
      status: 'active',
      metadata: { m: 1 },
      parentId: null,
      agentName: null,
    }]);
  });

  test('updateSession marks a manual title only when a title is present', () => {
    const updateInputs: unknown[] = [];
    const existing = makeSession({ metadata: { old: true } });
    const repository = makeRepository({
      getSession: () => existing,
      updateSession: (_id, updates) => {
        updateInputs.push(updates);
        return makeSession();
      },
    });
    const app = createSessionHttpApplication(repository);

    app.updateSession('sess-1', { title: 'New', metadata: null });
    app.updateSession('sess-1', { status: 'closed', metadata: { kept: true } });

    expect(updateInputs).toEqual([
      { title: 'New', status: undefined, metadata: { old: true, titleManuallyRenamed: true }, tags: undefined, autoApproveSeverity: undefined },
      { title: undefined, status: 'closed', metadata: { kept: true }, tags: undefined, autoApproveSeverity: undefined },
    ]);
  });

  test('updateSession returns null for a missing session', () => {
    const repository = makeRepository({ updateSession: () => null });
    const app = createSessionHttpApplication(repository);
    expect(app.updateSession('missing', { status: 'closed' })).toBeNull();
  });

  test('createAttachment resolves the workspace from the session and returns null when missing', () => {
    const createInputs: unknown[] = [];
    const repository = makeRepository({
      getSession: () => makeSession({ workspaceId: 'ws-42' }),
      attachments: {
        ...makeRepository().attachments,
        create: (input) => {
          createInputs.push(input);
          return { id: 'att-1', sessionId: input.sessionId, workspaceId: input.workspaceId, kind: 'file', filename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes, absolutePath: '/tmp/f', createdAt: new Date().toISOString(), accessKey: 'k' };
        },
      },
    });
    const app = createSessionHttpApplication(repository);

    const attachment = app.createAttachment({ sessionId: 'sess-1', filename: 'f.txt', mimeType: 'text/plain', sizeBytes: 3, data: new ArrayBuffer(0) });

    expect(createInputs).toEqual([expect.objectContaining({ workspaceId: 'ws-42', filename: 'f.txt' })]);
    expect(attachment?.workspaceId).toBe('ws-42');

    const missingApp = createSessionHttpApplication(makeRepository({ getSession: () => null }));
    expect(missingApp.createAttachment({ sessionId: 'missing', filename: 'f', mimeType: 'text/plain', sizeBytes: 1, data: new ArrayBuffer(0) })).toBeNull();
  });

  test('transcript reads delegate to the repository paging functions', () => {
    const latest: TranscriptPage = { messages: [], pagination: { hasOlder: false, oldestSequence: null, newestSequence: null, limit: 50 } };
    const before: TranscriptPage = { messages: [], pagination: { hasOlder: true, oldestSequence: 5, newestSequence: 10, limit: 10 } };
    const repository = makeRepository({
      listLatestMessagesWithPartsPage: () => latest,
      listMessagesWithPartsBeforeSequence: () => before,
    });
    const app = createSessionHttpApplication(repository);

    expect(app.latestTranscript('sess-1', 50)).toEqual(latest);
    expect(app.transcriptBefore('sess-1', 10, 10)).toEqual(before);
  });

  test('tool output limits and validation come from the repository port', () => {
    const repository = makeRepository({
      toolOutput: {
        defaultPageChars: 5,
        maxPageChars: 7,
        isArtifactId: (id: string) => id === 'valid',
        getPage: () => null,
      },
    });
    const app = createSessionHttpApplication(repository);

    expect(app.toolOutputLimits()).toEqual({ defaultPageChars: 5, maxPageChars: 7 });
    expect(app.isToolOutputArtifactId('valid')).toBe(true);
    expect(app.isToolOutputArtifactId('nope')).toBe(false);
  });

  test('attachment rules expose size, kind, and mime validation', () => {
    const repository = makeRepository({
      attachments: {
        ...makeRepository().attachments,
        maxSize: 42,
        determineKind: () => 'image',
        validateImageMime: (mimeType: string) => mimeType === 'image/png',
      },
    });
    const app = createSessionHttpApplication(repository);

    expect(app.attachmentRules().maxSize).toBe(42);
    expect(app.attachmentRules().determineKind('image/png')).toBe('image');
    expect(app.attachmentRules().validateImageMime('image/png')).toBe(true);
    expect(app.attachmentRules().validateImageMime('image/gif')).toBe(false);
  });

  test('grouped and tag listings pass through untouched', () => {
    const repository = makeRepository({
      listSessionsGrouped: () => ({ ws: [makeSession()] }),
      listSessionPageGrouped: () => ({ sessions: { ws: [makeSession()] }, pagination: { ws: { nextCursor: null, hasMore: false, limit: 1 } } }),
      listTagsByWorkspace: () => ['a', 'b'],
    });
    const app = createSessionHttpApplication(repository);

    expect(app.listSessionsGrouped(['ws'])).toEqual({ ws: [makeSession()] });
    expect(app.listSessionPageGrouped(['ws'], { limitPerWorkspace: 1 })).toEqual({
      sessions: { ws: [makeSession()] },
      pagination: { ws: { nextCursor: null, hasMore: false, limit: 1 } },
    });
    expect(app.listTagsByWorkspace('ws')).toEqual(['a', 'b']);
  });
});
