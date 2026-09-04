import { describe, expect, test } from 'bun:test';
import type {
  ManagedWorktreeRecord,
  WorktreeRepositoryIdentity,
} from '@/application/ports/worktree';
import { createWorktreeApplication } from '@/application/worktrees';
import type { Session, Workspace } from '@prokopai/sdk';

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    preconfigId: null,
    title: 'Session',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: null,
    parentId: null,
    agentName: null,
    ...overrides,
  };
}

function workspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/repo',
    isVirtual: false,
    additionalPaths: [],
    settings: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function setup(options: {
  dirty?: boolean;
  running?: boolean;
  hasMessages?: boolean;
  terminals?: number;
  inspectRepository?: () => Promise<WorktreeRepositoryIdentity>;
  remove?: () => Promise<void>;
  statusError?: Error;
} = {}) {
  const records = new Map<string, ManagedWorktreeRecord>();
  const sessions = new Map<string, Session>([['session-1', session()]]);
  const events: string[] = [];
  let removeCalls = 0;
  const application = createWorktreeApplication({
    dataDir: () => '/data',
    repository: {
      listByWorkspace: (workspaceId) => [...records.values()].filter((record) => record.workspaceId === workspaceId),
      listByRepository: (repositoryId) => [...records.values()].filter(
        (record) => record.repositoryId === repositoryId,
      ),
      get: (id) => records.get(id) ?? null,
      create: (record) => {
        records.set(record.id, record);
        return record;
      },
      update: (id, updates) => {
        const current = records.get(id);
        if (!current) return null;
        const updated = { ...current, ...updates, updatedAt: '2026-01-02T00:00:00.000Z' };
        records.set(id, updated);
        return updated;
      },
    },
    git: {
      inspectRepository: options.inspectRepository ?? (async () => ({
        repositoryId: 'repository-1',
        repositoryRoot: '/repo/.git',
        repositoryTopLevel: '/repo',
        selectedRoot: '/repo',
      })),
      listRefs: async () => [{
        name: 'main',
        ref: 'refs/heads/main',
        kind: 'local',
        commit: 'abc123',
        current: true,
        checkedOut: true,
      }],
      create: async ({ destinationPath, branch }) => ({
        branch: branch.slice('refs/heads/'.length),
        head: 'abc123',
        dirty: false,
        untrackedCount: 0,
        destinationPath,
      }),
      status: async () => {
        if (options.statusError) throw options.statusError;
        return {
          branch: 'feature/test',
          head: 'abc123',
          dirty: options.dirty ?? false,
          untrackedCount: options.dirty ? 1 : 0,
        };
      },
      remove: async () => {
        removeCalls += 1;
        await options.remove?.();
      },
    },
    workspaces: { get: (id) => id === 'workspace-1' ? workspace() : null },
    sessions: {
      get: (id) => sessions.get(id) ?? null,
      listByWorkspace: (workspaceId) => [...sessions.values()].filter((item) => item.workspaceId === workspaceId),
      updateWorkspaceRoot: (id, workspaceRootId) => {
        const current = sessions.get(id);
        if (!current) return null;
        const updated = { ...current, workspaceRootId };
        sessions.set(id, updated);
        return updated;
      },
      hasMessages: () => options.hasMessages ?? false,
      isRunning: () => options.running ?? false,
    },
    terminals: {
      listForWorktree: () => Array.from({ length: options.terminals ?? 0 }, (_, index) => ({ id: String(index) })),
    },
    events: {
      worktreeChanged: (worktree) => events.push(
        `worktree:${worktree.state}:${worktree.attachments.length}`,
      ),
      sessionChanged: (updated) => events.push(`session:${updated.workspaceRootId ?? 'primary'}`),
    },
  });
  return { application, records, sessions, events, getRemoveCalls: () => removeCalls };
}

describe('managed worktree application', () => {
  test('creates a repository-scoped managed path and binds an idle session', async () => {
    const state = setup();
    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path).toBe(`/data/worktrees/repository-1/${created.value.id}`);

    const bound = await state.application.bind('session-1', created.value.id);
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;
    expect(bound.value.worktree).toEqual({
      id: created.value.id,
      name: 'test-worktree',
      branch: 'feature/test',
      path: created.value.path,
      state: 'available',
    });
    expect(state.sessions.get('session-1')?.workspaceRootId).toBe(created.value.id);
    expect(state.events).toEqual([
      'worktree:available:0',
      `session:${created.value.id}`,
      'worktree:available:1',
    ]);

    const unbound = await state.application.unbind('session-1');
    expect(unbound.ok).toBe(true);
    if (!unbound.ok) return;
    expect(unbound.value.workspaceRootId).toBeNull();
    expect(unbound.value.worktree).toBeNull();
    expect(state.events.at(-1)).toBe('worktree:available:0');
  });

  test('rejects a duplicate active worktree name without invoking Git again', async () => {
    const state = setup();
    const first = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    expect(first.ok).toBe(true);

    const duplicate = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/other',
    });

    expect(duplicate).toEqual({
      ok: false,
      code: 'worktree_name_exists',
      message: 'A worktree named "test-worktree" already exists',
    });
  });

  test('refuses checkout changes after the first message', async () => {
    const state = setup({ hasMessages: true });
    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    if (!created.ok) throw new Error(created.message);

    const bound = await state.application.bind('session-1', created.value.id);
    expect(bound).toEqual({
      ok: false,
      code: 'session_has_messages',
      message: 'A session checkout cannot be changed after its first message',
    });

    state.sessions.set('session-1', session({ workspaceRootId: created.value.id }));
    const unbound = await state.application.unbind('session-1');
    expect(unbound).toEqual({
      ok: false,
      code: 'session_has_messages',
      message: 'A session checkout cannot be changed after its first message',
    });
  });

  test('refuses dirty, running, and terminal-attached removal without invoking Git remove', async () => {
    const cases = [
      { options: { dirty: true }, code: 'worktree_dirty' },
      { options: { running: true }, code: 'session_running' },
      { options: { terminals: 1 }, code: 'terminal_attached' },
    ] as const;
    for (const { options, code } of cases) {
      const state = setup(options);
      const created = await state.application.create('workspace-1', {
        name: 'test-worktree',
        branch: 'refs/heads/feature/test',
      });
      if (!created.ok) throw new Error(created.message);
      if ('running' in options && options.running) {
        state.sessions.set('session-1', session({ workspaceRootId: created.value.id }));
      } else {
        await state.application.bind('session-1', created.value.id);
      }
      const removed = await state.application.remove('workspace-1', created.value.id);
      expect(removed).toMatchObject({ ok: false, code });
      expect(state.getRemoveCalls()).toBe(0);
    }
  });

  test('removes only a clean idle worktree and retains a removed record', async () => {
    const state = setup();
    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    if (!created.ok) throw new Error(created.message);
    const removed = await state.application.remove('workspace-1', created.value.id);
    expect(removed.ok).toBe(true);
    expect(state.getRemoveCalls()).toBe(1);
    expect(state.records.get(created.value.id)?.state).toBe('removed');
  });

  test('rejects repositories whose top level is outside the selected workspace', async () => {
    const state = setup({
      inspectRepository: async () => ({
        repositoryId: 'repository-1',
        repositoryRoot: '/parent/.git',
        repositoryTopLevel: '/parent',
        selectedRoot: '/parent/nested-workspace',
      }),
    });

    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });

    expect(created).toMatchObject({ ok: false, code: 'repository_outside_workspace' });
  });

  test('rejects creation when repository identity changes inside the queue', async () => {
    let inspections = 0;
    const state = setup({
      inspectRepository: async () => {
        inspections += 1;
        return {
          repositoryId: inspections === 1 ? 'repository-1' : 'repository-2',
          repositoryRoot: inspections === 1 ? '/repo/.git' : '/repo/.git-changed',
          repositoryTopLevel: '/repo',
          selectedRoot: '/repo',
        };
      },
    });

    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });

    expect(created).toMatchObject({ ok: false, code: 'repository_changed' });
  });

  test('marks a missing worktree unavailable when binding', async () => {
    const missingError = Object.assign(new Error('missing'), { code: 'worktree_missing' });
    const state = setup({ statusError: missingError });
    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    if (!created.ok) throw new Error(created.message);

    const bound = await state.application.bind('session-1', created.value.id);

    expect(bound).toMatchObject({ ok: false, code: 'worktree_unavailable' });
    expect(state.records.get(created.value.id)?.state).toBe('missing');
  });

  test('serializes concurrent removal and binding against the removal reservation', async () => {
    let releaseRemove = (): void => {};
    let markRemoveStarted = (): void => {};
    const removeStarted = new Promise<void>((resolve) => {
      markRemoveStarted = resolve;
    });
    const removeGate = new Promise<void>((resolve) => {
      releaseRemove = resolve;
    });
    const state = setup({
      remove: async () => {
        markRemoveStarted();
        await removeGate;
      },
    });
    const created = await state.application.create('workspace-1', {
      name: 'test-worktree',
      branch: 'refs/heads/feature/test',
    });
    if (!created.ok) throw new Error(created.message);

    const firstRemoval = state.application.remove('workspace-1', created.value.id);
    await removeStarted;
    const secondRemoval = state.application.remove('workspace-1', created.value.id);
    const binding = state.application.bind('session-1', created.value.id);
    releaseRemove();

    expect(await firstRemoval).toMatchObject({ ok: true });
    expect(await secondRemoval).toMatchObject({ ok: false, code: 'worktree_unavailable' });
    expect(await binding).toMatchObject({ ok: false, code: 'worktree_unavailable' });
    expect(state.getRemoveCalls()).toBe(1);
  });
});
