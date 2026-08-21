import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AssistantMessage, ToolPart } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage/types';

const { mockInvalidate } = vi.hoisted(() => ({ mockInvalidate: vi.fn() }));

vi.mock('@/components/providers/QueryProvider', () => {
  return { queryClient: { invalidateQueries: mockInvalidate } };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

vi.mock('@/stores/pendingOperationsStore', () => ({
  usePendingOperationsStore: {
    getState: () => ({
      clearOperation: vi.fn(),
      getSessionPendingOperations: () => [],
      clearSessionOperations: vi.fn(),
    }),
  },
}));

import { handleMessageUpdated, handlePartUpdated } from '@/handlers/serverMessage/messagePartHandlers';
import { queryKeys } from '@/lib/queryKeys';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';

function getInvalidatedKeys(): readonly (readonly unknown[])[] {
  return mockInvalidate.mock.calls.map((c: unknown[]) => {
    const arg = c[0] as { queryKey: readonly unknown[] };
    return arg.queryKey;
  });
}

function makeCtx(): SessionHandlersContext {
  return {
    setMessagesBySession: vi.fn(),
    setPartsBySession: vi.fn(),
    setSessionUsage: vi.fn(),
    setCurrentModel: vi.fn(),
    addStreamingSession: vi.fn(),
    removeStreamingSession: vi.fn(),
    removeInterruptedSession: vi.fn(),
    partIdIndexRef: { current: new Map() },
    partAppendRafRef: { current: null },
    partAppendTimeoutRef: { current: null },
    flushPendingPartAppends: vi.fn(),
    pendingPartAppendsRef: { current: new Map() },
    currentSessionIdRef: { current: 'sess-1' },
    sessionsRef: { current: [] },
    setCompletion: vi.fn(),
    clearCompletion: vi.fn(),
    chatFinishSoundEnabledRef: { current: false },
    playChatFinishSound: vi.fn(),
    acknowledgeNotification: vi.fn(),
    setCompactionSuccess: vi.fn(),
    interruptedSessions: new Set<string>(),
  } as unknown as SessionHandlersContext;
}

function makeAssistantMessage(status: 'completed' | 'error'): AssistantMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    role: 'assistant',
    status,
    modelId: 'model-1',
    providerId: 'provider-1',
    tokens: { prompt: 1, completion: 1 },
    cost: 0,
    createdAt: Date.now(),
  };
}

function makeToolPart(
  name: string,
  status: 'completed' | 'error' | 'interrupted',
): ToolPart {
  return {
    id: 'part-1',
    messageId: 'msg-1',
    type: 'tool',
    name,
    state: { status },
  } as unknown as ToolPart;
}

describe('messagePartHandlers notification acknowledgement', () => {
  beforeEach(() => {
    useSessionStore.setState({
      messagesBySession: {
        'sess-1': [makeAssistantMessage('completed')],
      },
    });
    useSessionBoardStore.setState({
      openSessionIds: ['sess-1'],
      focusedSessionId: 'sess-1',
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('acknowledges a displayed completion while visible and focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const ctx = makeCtx();
    ctx.sessionsRef.current = [{
      id: 'sess-1',
      parentId: null,
    }] as unknown as typeof ctx.sessionsRef.current;

    handleMessageUpdated({
      type: 'message.updated',
      message: makeAssistantMessage('completed'),
    }, ctx);

    expect(ctx.acknowledgeNotification).toHaveBeenCalledWith(
      'message:msg-1:completed',
      'sess-1',
    );
  });

  test('does not acknowledge while the client is hidden', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    const ctx = makeCtx();
    ctx.sessionsRef.current = [{
      id: 'sess-1',
      parentId: null,
    }] as unknown as typeof ctx.sessionsRef.current;

    handleMessageUpdated({
      type: 'message.updated',
      message: makeAssistantMessage('completed'),
    }, ctx);

    expect(ctx.acknowledgeNotification).not.toHaveBeenCalled();
  });
});

describe('messagePartHandlers - file query invalidation', () => {
  beforeEach(() => {
    mockInvalidate.mockClear();
  });

  test('completed file-mutating tool invalidates browse, search, and git-status', () => {
    const part = makeToolPart('edit', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    expect(invalidatedKeys).toContainEqual(queryKeys.files.browsePrefix);
    expect(invalidatedKeys).toContainEqual(queryKeys.files.searchPrefix);
    expect(invalidatedKeys).toContainEqual(queryKeys.files.gitStatusPrefix);
  });

  test('does not invalidate file preview or git-diff queries', () => {
    const part = makeToolPart('edit', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    const hasPreview = invalidatedKeys.some(
      (k) => k[0] === 'files' && k[1] === 'preview',
    );
    const hasGitDiff = invalidatedKeys.some(
      (k) => k[0] === 'files' && k[1] === 'git-diff',
    );
    expect(hasPreview).toBe(false);
    expect(hasGitDiff).toBe(false);
  });

  test('error terminal state triggers same invalidation', () => {
    const part = makeToolPart('write-file', 'error');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    expect(invalidatedKeys).toContainEqual(queryKeys.files.browsePrefix);
    expect(invalidatedKeys).toContainEqual(queryKeys.files.gitStatusPrefix);
  });

  test('interrupted terminal state triggers same invalidation', () => {
    const part = makeToolPart('apply-patch', 'interrupted');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    expect(invalidatedKeys).toContainEqual(queryKeys.files.browsePrefix);
  });

  test('shell is classified as file-mutating and invalidates file queries', () => {
    const part = makeToolPart('shell', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    expect(invalidatedKeys).toContainEqual(queryKeys.files.browsePrefix);
    expect(invalidatedKeys).toContainEqual(queryKeys.files.gitStatusPrefix);
  });

  test('non-file tool does not invalidate file queries', () => {
    const part = makeToolPart('read-file', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    const invalidatedKeys = getInvalidatedKeys();

    const hasAnyFileKey = invalidatedKeys.some(
      (k) => k[0] === 'files',
    );
    expect(hasAnyFileKey).toBe(false);
  });

  test('file-mutating tool in non-terminal state does not invalidate', () => {
    const part = makeToolPart('edit', 'running' as 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());

    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
