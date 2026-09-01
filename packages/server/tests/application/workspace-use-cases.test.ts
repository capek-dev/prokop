import { describe, expect, test } from 'bun:test';
import type {
  PinnedMessage,
  Session,
  Workspace,
  WorkspaceSettings,
} from '@prokopai/sdk';
import {
  createWorkspaceApplication,
  type WorkspaceApplication,
} from '@/application/workspaces';
import type {
  WorkspaceCleanupPort,
  WorkspaceDirectoryPort,
  WorkspacePathConfigPort,
  WorkspacePinnedPort,
  WorkspaceRepositoryPort,
  WorkspaceSessionListingPort,
  WorkspaceTerminalPort,
} from '@/application/ports/workspace';

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'Workspace',
    path: '/data/workspaces/ws-1',
    isVirtual: false,
    additionalPaths: [],
    settings: { autoApproveSeverity: 'low' },
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as Workspace;
}

interface FakeState {
  workspaces: Map<string, Workspace>;
  sessions: Session[];
  pinned: PinnedMessage[];
  mkdirs: string[];
  log: string[];
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    workspaceId: 'ws-1',
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    createdAt: 'c',
    updatedAt: 'u',
    ...overrides,
  } as Session;
}

function makeState(): FakeState {
  return {
    workspaces: new Map(),
    sessions: [],
    pinned: [],
    mkdirs: [],
    log: [],
  };
}

function makeFakes(state: FakeState) {
  const repository: WorkspaceRepositoryPort = {
    list: () => Array.from(state.workspaces.values()).filter(w => !w.settings?.isAgentHome),
    listAgentHomes: () => Array.from(state.workspaces.values()).filter(w => w.settings?.isAgentHome),
    get: (id) => state.workspaces.get(id) ?? null,
    create: (input) => {
      const workspace = makeWorkspace({
        id: input.id,
        name: input.name,
        path: input.path,
        isVirtual: input.isVirtual,
        additionalPaths: input.additionalPaths ?? [],
        settings: input.settings ?? { autoApproveSeverity: 'low' },
      });
      state.workspaces.set(workspace.id, workspace);
      state.log.push(`create:${input.id}:${input.name}`);
      return workspace;
    },
    update: (id, updates) => {
      const existing = state.workspaces.get(id);
      if (!existing) return null;
      const updated = makeWorkspace({
        ...existing,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.path !== undefined ? { path: updates.path } : {}),
        ...(updates.additionalPaths !== undefined ? { additionalPaths: updates.additionalPaths } : {}),
        ...(updates.settings !== undefined ? { settings: updates.settings } : {}),
      });
      state.workspaces.set(id, updated);
      state.log.push(`update:${id}`);
      return updated;
    },
    delete: (id) => {
      state.log.push(`delete:${id}`);
      return state.workspaces.delete(id);
    },
    addAdditionalPath: (id, path) => {
      state.log.push(`addPath:${id}:${path}`);
      return true;
    },
    removeAdditionalPath: (id, path) => {
      state.log.push(`removePath:${id}:${path}`);
      return true;
    },
    autoApproveSeverity: () => 'low',
  };

  const sessions: WorkspaceSessionListingPort = {
    listByWorkspace: (workspaceId) => {
      state.log.push(`listSessions:${workspaceId}`);
      return state.sessions.filter(s => s.workspaceId === workspaceId);
    },
    listPageByWorkspace: (workspaceId, options) => ({
      sessions: state.sessions.filter(s => s.workspaceId === workspaceId),
      nextCursor: null,
      hasMore: false,
      limit: options.limit,
    }),
    encodeCursor: (payload) => `enc:${payload.id}`,
    decodeCursor: (cursor) => {
      const match = /^enc:(.+)$/.exec(cursor);
      return match ? { version: 1, updatedAt: 'u', id: match[1] } : null;
    },
    defaultPageSize: 50,
    cleanupOutputDirs: (sessionIds) => {
      state.log.push(`cleanupDirs:${sessionIds.join(',')}`);
    },
  };

  const pinned: WorkspacePinnedPort = {
    list: (workspaceId) => {
      state.log.push(`listPinned:${workspaceId}`);
      return state.pinned;
    },
    pin: (input) => {
      state.log.push(`pin:${input.sessionId}:${input.messageId}`);
      const record = { id: 'p-1', workspaceId: input.workspaceId, sessionId: input.sessionId, messageId: input.messageId } as PinnedMessage;
      state.pinned.push(record);
      return record;
    },
    unpin: (workspaceId, messageId) => {
      state.log.push(`unpin:${workspaceId}:${messageId}`);
      return true;
    },
  };

  const terminals: WorkspaceTerminalPort = {
    listForWorkspace: (workspacePath) => {
      state.log.push(`listTerminals:${workspacePath}`);
      return [{ id: 't-1', cwd: workspacePath }];
    },
    createDetached: (options) => {
      state.log.push(`createTerminal:${options.workspaceId}:${options.cwd}`);
      return options.workspaceId === 'limited' ? null : 't-new';
    },
    get: (sessionId) => (sessionId === 't-new' ? { id: 't-new' } : sessionId === 't-1' ? { id: 't-1' } : null),
    destroyById: (sessionId) => {
      state.log.push(`destroyTerminal:${sessionId}`);
    },
    destroyForWorkspace: (workspacePath) => {
      state.log.push(`destroyTerminals:${workspacePath}`);
    },
  };

  const cleanup: WorkspaceCleanupPort = {
    mcpShutdown: async (workspacePath) => {
      state.log.push(`mcpShutdown:${workspacePath}`);
      if (workspacePath.includes('mcp-fails')) throw new Error('mcp exploded');
    },
    deleteScheduledJobs: (workspaceId) => {
      state.log.push(`deleteScheduledJobs:${workspaceId}`);
      return 1;
    },
  };

  const directory: WorkspaceDirectoryPort = {
    mkdir: (path) => {
      state.log.push(`mkdir:${path}`);
      if (path.includes('mkdir-fails')) throw new Error('no directory for you');
      state.mkdirs.push(path);
    },
    exists: (path) => path.startsWith('/') && !path.includes('missing'),
  };

  const paths: WorkspacePathConfigPort = {
    workspacesDir: () => '/data/workspaces',
    expandPath: (path) => path,
  };

  return { repository, sessions, pinned, terminals, cleanup, directory, paths };
}

function makeApplication(state: FakeState): WorkspaceApplication {
  return createWorkspaceApplication(makeFakes(state));
}

describe('workspace application use cases', () => {
  test('list auto-creates the default virtual workspace when none exist', () => {
    const state = makeState();
    const application = makeApplication(state);

    const result = application.list();
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.workspaces).toHaveLength(1);
      expect(result.workspaces[0]).toMatchObject({ name: 'Virtual Workspace', isVirtual: true });
      expect(result.workspaces[0].path.startsWith('/data/workspaces/')).toBe(true);
    }
    expect(state.log.some(entry => entry.startsWith('mkdir:/data/workspaces/'))).toBe(true);
    expect(state.log.some(entry => entry.includes('Virtual Workspace'))).toBe(true);
  });

  test('list returns the mkdir failure result without creating a workspace', () => {
    const state = makeState();
    const directory = makeFakes(state).directory;
    const application = createWorkspaceApplication({
      ...makeFakes(state),
      directory: {
        ...directory,
        mkdir: (path) => {
          state.log.push(`mkdir:${path}`);
          throw new Error('boom');
        },
      },
    });

    expect(application.list()).toEqual({ kind: 'mkdir_failed' });
    expect(state.workspaces.size).toBe(0);
  });

  test('list skips auto-creation when workspaces exist', () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace());
    const application = makeApplication(state);

    const result = application.list();
    expect(result.kind).toBe('ok');
    expect(state.log.some(entry => entry.startsWith('mkdir:'))).toBe(false);
  });

  test('create shapes the exact input policy', () => {
    const state = makeState();
    const application = makeApplication(state);

    // Physical workspace without a path is rejected.
    expect(application.create({ name: 'X', isVirtual: false })).toEqual({ kind: 'path_required' });

    // Virtual without path generates one; name defaults; additional paths
    // are expanded and existence-filtered.
    const virtual = application.create({ isVirtual: true, additionalPaths: ['/extra', '/extra/missing'] });
    expect(virtual.kind).toBe('created');
    if (virtual.kind === 'created') {
      expect(virtual.workspace).toMatchObject({
        name: 'New Workspace',
        isVirtual: true,
        additionalPaths: ['/extra'],
      });
    }

    const physical = application.create({ name: 'Physical', path: '/real/path', additionalPaths: ['/missing', '/extra'] });
    expect(physical.kind).toBe('created');
    if (physical.kind === 'created') {
      expect(physical.workspace).toMatchObject({ name: 'Physical', path: '/real/path', additionalPaths: ['/extra'] });
    }

    const mkdirs = state.log.filter(entry => entry.startsWith('mkdir:'));
    expect(mkdirs).toHaveLength(2);
    expect(mkdirs[0].startsWith('mkdir:/data/workspaces/')).toBe(true);
    expect(mkdirs[1]).toBe('mkdir:/real/path');
  });

  test('create reports mkdir failures', () => {
    const state = makeState();
    const application = makeApplication(state);
    expect(application.create({ name: 'X', path: '/mkdir-fails/path' })).toEqual({ kind: 'mkdir_failed' });
  });

  test('update enforces the fields requirement and validates additional paths', () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace());
    const application = makeApplication(state);

    expect(application.update('ws-1', {})).toEqual({ kind: 'no_fields' });
    expect(application.update('missing', { name: 'x' })).toEqual({ kind: 'missing' });

    const updated = application.update('ws-1', {
      name: 'Renamed',
      path: '/renamed/workspace',
      additionalPaths: ['/extra', '/missing'],
      settings: { memory: { enabled: true } } as WorkspaceSettings,
    });
    expect(updated.kind).toBe('ok');
    if (updated.kind === 'ok') {
      expect(updated.workspace).toMatchObject({
        name: 'Renamed',
        path: '/renamed/workspace',
        additionalPaths: ['/extra'],
      });
    }

    expect(application.update('ws-1', { path: '/missing/workspace' })).toEqual({
      kind: 'path_not_found',
    });
  });

  test('delete performs the exact cleanup ordering and reports deleted sessions', async () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace({ path: '/ws-path' }));
    state.sessions = [makeSession(), makeSession({ id: 'sess-2' })];
    const application = makeApplication(state);

    const result = await application.deleteWorkspace('ws-1');
    expect(result).toEqual({ kind: 'ok', deletedSessions: ['sess-1', 'sess-2'] });

    const relevant = state.log.filter((entry, index) =>
      index >= state.log.indexOf('listSessions:ws-1'),
    );
    expect(relevant).toEqual([
      'listSessions:ws-1',
      'mcpShutdown:/ws-path',
      'destroyTerminals:/ws-path',
      'deleteScheduledJobs:ws-1',
      'delete:ws-1',
      'cleanupDirs:sess-1,sess-2',
    ]);
  });

  test('delete logs and continues when MCP shutdown fails', async () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace({ path: '/mcp-fails/path' }));
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warns.push(args);
    try {
      const application = makeApplication(state);
      const result = await application.deleteWorkspace('ws-1');
      expect(result.kind).toBe('ok');
    } finally {
      console.warn = originalWarn;
    }
    expect(warns).toEqual([['[workspace cleanup] Failed to shutdown MCP workspace /mcp-fails/path:', expect.any(Error)]]);
    expect(state.log).toContain('delete:ws-1');
  });

  test('delete reports a missing workspace without cleanup', async () => {
    const state = makeState();
    const application = makeApplication(state);
    expect(await application.deleteWorkspace('missing')).toEqual({ kind: 'missing' });
    expect(state.log).toEqual([]);
  });

  test('terminal use cases support registered workspace roots and reject other paths', () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace({
      path: '/ws-path',
      additionalPaths: ['/shared'],
    }));
    state.workspaces.set('limited', makeWorkspace({ id: 'limited', path: '/limited' }));
    const application = makeApplication(state);

    expect(application.listTerminals('ws-1')).toEqual({
      kind: 'ok',
      sessions: [
        { id: 't-1', cwd: '/ws-path' },
        { id: 't-1', cwd: '/shared' },
      ],
    });
    expect(application.listTerminals('missing')).toEqual({ kind: 'missing' });
    expect(application.createTerminal('missing')).toEqual({ kind: 'missing' });
    expect(application.createTerminal('limited')).toEqual({ kind: 'limit' });
    expect(application.createTerminal('ws-1', '/outside')).toEqual({ kind: 'invalid_path' });
    expect(application.createTerminal('ws-1', '/shared')).toEqual({ kind: 'ok', session: { id: 't-new' } });
    expect(state.log).toContain('createTerminal:ws-1:/shared');
    expect(application.getTerminal('t-new')).toEqual({ id: 't-new' });
    expect(application.getTerminal('missing-terminal')).toBeNull();
    application.destroyTerminal('t-new');
    expect(state.log).toContain('destroyTerminal:t-new');
  });

  test('session listing use cases validate cursors and limits', () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace());
    state.sessions = [makeSession()];
    const application = makeApplication(state);

    expect(application.listSessions('ws-1', {})).toEqual({ kind: 'ok', sessions: [state.sessions[0]] });
    expect(application.listSessions('missing', {})).toEqual({ kind: 'missing' });

    expect(application.listSessionPage('ws-1', { cursorParam: 'bad' })).toEqual({ kind: 'bad_cursor' });
    expect(application.listSessionPage('ws-1', { limitParam: '0' })).toEqual({ kind: 'bad_limit' });
    expect(application.listSessionPage('ws-1', { limitParam: '101' })).toEqual({ kind: 'bad_limit' });
    const page = application.listSessionPage('ws-1', { cursorParam: 'enc:c-1', limitParam: '10' });
    expect(page.kind).toBe('ok');
    if (page.kind === 'ok') {
      expect(page.page.limit).toBe(10);
      expect(page.page.sessions).toHaveLength(1);
    }
    expect(application.encodeCursor({ version: 1, updatedAt: 'u', id: 'x' })).toBe('enc:x');
  });

  test('pinned message use cases keep the pin-without-check asymmetry', () => {
    const state = makeState();
    state.workspaces.set('ws-1', makeWorkspace());
    const application = makeApplication(state);

    expect(application.listPinned('ws-1')).toEqual({ kind: 'ok', pinnedMessages: [] });
    expect(application.listPinned('missing')).toEqual({ kind: 'missing' });

    const pinned = application.pin({ workspaceId: 'ws-1', sessionId: 'sess-1', messageId: 'msg-1' });
    expect(pinned).toMatchObject({ workspaceId: 'ws-1', sessionId: 'sess-1', messageId: 'msg-1' });

    expect(application.unpin('ws-1', 'msg-1')).toEqual({ kind: 'ok' });
    expect(application.unpin('missing', 'msg-1')).toEqual({ kind: 'missing' });
  });
});
