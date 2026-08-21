import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

vi.mock('@/components/providers/QueryProvider', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

import { handleSessionUpdated } from '@/handlers/serverMessage/sessionHandlers';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';

function createContext(): SessionHandlersContext {
  return {
    setSessions: vi.fn((updater: (sessions: Session[]) => Session[]) => updater([])),
    setModelForSession: vi.fn(),
    setVariantForSession: vi.fn(),
  } as unknown as SessionHandlersContext;
}

describe('handleSessionUpdated', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePendingOperationsStore.setState({ operations: [] });
  });

  test('acknowledges a pending compaction when the server reports it started', () => {
    vi.spyOn(Date, 'now').mockReturnValue(25_000);
    usePendingOperationsStore.getState().startOperation({
      type: 'compact',
      sessionId: 'session-1',
      startedAt: 20_000,
    });

    handleSessionUpdated({
      type: 'session.updated',
      session: {
        id: 'session-1',
        compacting: true,
      } as Session,
    }, createContext());

    expect(usePendingOperationsStore.getState().operations[0]).toMatchObject({
      type: 'compact',
      sessionId: 'session-1',
      acknowledgedAt: 25_000,
    });
  });
});
