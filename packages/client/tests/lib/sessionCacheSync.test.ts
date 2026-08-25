import { describe, test, expect, beforeEach } from 'vitest';
import { queryClient } from '@/components/providers/QueryProvider';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';
import { startSessionCacheSync, stopSessionCacheSync } from '@/lib/sessionCacheSync';
import type { Session } from '@prokopai/sdk';

function makeSession(id: string, workspaceId: string, updatedAt: string, overrides: Partial<Session> = {}): Session {
  return { id, workspaceId, updatedAt, ...overrides } as Session;
}

const key = queryKeys.sessions.byWorkspaceInfinite({ workspaceId: 'ws1', limit: 100, rootOnly: true });

const s1 = makeSession('s1', 'ws1', '2025-01-01T00:00:00.000Z');
const s2 = makeSession('s2', 'ws1', '2025-01-02T00:00:00.000Z');
const s2dup = makeSession('s2', 'ws1', '2025-01-02T00:00:00.000Z', { title: 'S2 updated' });
const s3 = makeSession('s3', 'ws1', '2025-01-03T00:00:00.000Z');

const pages = {
  pages: [{ sessions: [s1, s2] }, { sessions: [s2dup, s3] }],
  pageParams: [undefined, 'cursor'],
};

describe('sessionCacheSync', () => {
  beforeEach(() => {
    stopSessionCacheSync();
    queryClient.clear();
    useSessionStore.getState().clearSessions();
    startSessionCacheSync();
  });

  test('syncs deduped sorted sessions into the store on query updates', () => {
    queryClient.setQueryData(key, pages);

    const sessions = useSessionStore.getState().sessions;
    expect(sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    expect(sessions.find((s) => s.id === 's2')?.title).toBe('S2 updated');
  });

  test('dedupes sessions with the same id keeping the last page occurrence', () => {
    queryClient.setQueryData(key, { pages: [{ sessions: [s1, s2] }], pageParams: [undefined] });
    queryClient.setQueryData(key, { pages: [{ sessions: [s2dup] }], pageParams: [undefined] });

    const sessions = useSessionStore.getState().sessions;
    expect(sessions.map((s) => s.id)).toEqual(['s2']);
    expect(sessions.find((s) => s.id === 's2')?.title).toBe('S2 updated');
  });

  test('updated event with undefined data does not wipe sessions', () => {
    queryClient.setQueryData(key, pages);
    expect(useSessionStore.getState().sessions).toHaveLength(3);

    queryClient.setQueryData(key, undefined);

    expect(useSessionStore.getState().sessions).toHaveLength(3);
  });

  test('removed query clears sessions for the workspace', () => {
    queryClient.setQueryData(key, pages);
    expect(useSessionStore.getState().sessions).toHaveLength(3);

    queryClient.removeQueries({ queryKey: key, exact: true });

    expect(useSessionStore.getState().sessions).toEqual([]);
  });

  test('stopSessionCacheSync stops syncing', () => {
    queryClient.setQueryData(key, pages);
    expect(useSessionStore.getState().sessions).toHaveLength(3);

    stopSessionCacheSync();
    queryClient.setQueryData(key, {
      pages: [{ sessions: [makeSession('s9', 'ws1', '2025-01-09T00:00:00.000Z')] }],
      pageParams: [undefined],
    });

    expect(useSessionStore.getState().sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
  });
});
