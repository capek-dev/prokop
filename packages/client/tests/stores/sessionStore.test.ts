import { describe, test, expect, beforeEach } from 'vitest';
import { useSessionStore } from '@/stores/sessionStore';
import type { Session } from '@prokopai/sdk';

function makeSession(id: string, workspaceId: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    workspaceId,
    preconfigId: null,
    title: `Session ${id}`,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: null,
    selectedModel: null,
    selectedProvider: null,
    selectedVariant: null,
    parentId: null,
    agentName: null,
    subagentStatus: null,
    runningAt: null,
    compacting: false,
    tags: [],
    autoApproveSeverity: null,
    agentId: null,
    ...overrides,
  } as Session;
}

describe('sessionStore pagination operations (Phase 6)', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSessions();
  });

  test('mergeSessions replaces matching IDs and adds new IDs', () => {
    const store = useSessionStore.getState();
    store.setSessions([makeSession('s1', 'ws1'), makeSession('s2', 'ws1')]);

    store.mergeSessions([
      makeSession('s2', 'ws1', { title: 'Updated S2' }),
      makeSession('s3', 'ws1'),
    ]);

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(3);
    const s2 = sessions.find(s => s.id === 's2');
    expect(s2?.title).toBe('Updated S2');
    expect(sessions.find(s => s.id === 's3')).toBeDefined();
  });

  test('replaceSessionsForWorkspace replaces only one workspace, keeps others', () => {
    const store = useSessionStore.getState();
    store.setSessions([
      makeSession('ws1-a', 'ws1'),
      makeSession('ws1-b', 'ws1'),
      makeSession('ws2-a', 'ws2'),
    ]);

    store.replaceSessionsForWorkspace('ws1', [makeSession('ws1-new', 'ws1')]);

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.find(s => s.id === 'ws1-new')).toBeDefined();
    expect(sessions.find(s => s.id === 'ws2-a')).toBeDefined();
    expect(sessions.find(s => s.id === 'ws1-a')).toBeUndefined();
  });

  test('removeSessionsForWorkspace removes only matching workspace', () => {
    const store = useSessionStore.getState();
    store.setSessions([
      makeSession('ws1-a', 'ws1'),
      makeSession('ws2-a', 'ws2'),
    ]);

    store.removeSessionsForWorkspace('ws1');

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('ws2-a');
  });

  test('addSessionToFront does not duplicate existing session', () => {
    const store = useSessionStore.getState();
    store.setSessions([makeSession('s1', 'ws1')]);
    store.addSessionToFront(makeSession('s1', 'ws1', { title: 'Updated' }));

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Updated');
  });

  test('addSessionToFront prepends new session', () => {
    const store = useSessionStore.getState();
    store.setSessions([makeSession('s1', 'ws1')]);
    store.addSessionToFront(makeSession('s2', 'ws1'));

    const sessions = useSessionStore.getState().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('s2');
  });
});
