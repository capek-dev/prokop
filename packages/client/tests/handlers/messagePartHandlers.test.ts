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

test('authoritative text snapshot discards buffered deltas before the trailing flush', () => {
  useSessionStore.setState({ partsBySession: { 'sess-1': { 'msg-1': [] } } });
  const ctx = makeCtx();
  ctx.pendingPartAppendsRef.current.set('text-1', 'Hello');
  const part = { id: 'text-1', messageId: 'msg-1', type: 'text', text: 'Hello!', createdAt: Date.now() } as const;
  handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, ctx);
  expect(ctx.pendingPartAppendsRef.current.has('text-1')).toBe(false);
  expect(ctx.setPartsBySession).toHaveBeenCalled();
});

describe('messagePartHandlers - file query invalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvalidate.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    mockInvalidate.mockClear();
  });

  function ctxWithWorkspaceSession(): SessionHandlersContext {
    const ctx = makeCtx();
    ctx.sessionsRef.current = [{
      id: 'sess-1',
      parentId: null,
      workspaceId: 'ws-1',
    }] as unknown as typeof ctx.sessionsRef.current;
    return ctx;
  }

  test('completed file-mutating tool debounces a workspace-scoped invalidation', () => {
    const part = makeToolPart('edit', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, ctxWithWorkspaceSession());

    expect(mockInvalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);

    const invalidatedKeys = getInvalidatedKeys();
    expect(invalidatedKeys).toContainEqual(['files', 'browse', 'ws-1']);
    expect(invalidatedKeys).toContainEqual(['files', 'search', 'ws-1']);
    expect(invalidatedKeys).toContainEqual(['files', 'git-diff', 'ws-1']);
    expect(invalidatedKeys).toContainEqual(['files', 'preview', 'ws-1']);
    // Git status and the file tree are pushed by the server feeds, not refetched per tool.
    expect(invalidatedKeys).not.toContainEqual(['files', 'git-status', 'ws-1']);
    expect(invalidatedKeys).not.toContainEqual(['files', 'tree', 'ws-1']);
  });

  test('a burst of completions coalesces into a single invalidation batch', () => {
    for (const name of ['shell', 'write-file', 'edit']) {
      handlePartUpdated(
        { type: 'part.updated', sessionId: 'sess-1', part: makeToolPart(name, 'completed') },
        ctxWithWorkspaceSession(),
      );
    }
    vi.advanceTimersByTime(300);

    // One batched set: browse, search, diffs, previews.
    expect(mockInvalidate).toHaveBeenCalledTimes(4);
  });

  test('error and interrupted terminal states invalidate the workspace', () => {
    handlePartUpdated(
      { type: 'part.updated', sessionId: 'sess-1', part: makeToolPart('write-file', 'error') },
      ctxWithWorkspaceSession(),
    );
    vi.advanceTimersByTime(300);
    expect(mockInvalidate).toHaveBeenCalled();

    mockInvalidate.mockClear();
    handlePartUpdated(
      { type: 'part.updated', sessionId: 'sess-1', part: makeToolPart('terminal', 'interrupted') },
      ctxWithWorkspaceSession(),
    );
    vi.advanceTimersByTime(300);
    expect(mockInvalidate).toHaveBeenCalled();
  });

  test('non-file tool does not invalidate file queries', () => {
    const part = makeToolPart('read-file', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, ctxWithWorkspaceSession());
    vi.advanceTimersByTime(300);

    const invalidatedKeys = getInvalidatedKeys();
    const hasAnyFileKey = invalidatedKeys.some(
      (k) => k[0] === 'files',
    );
    expect(hasAnyFileKey).toBe(false);
  });

  test('file-mutating tool in non-terminal state does not invalidate', () => {
    const part = makeToolPart('edit', 'running' as 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, ctxWithWorkspaceSession());
    vi.advanceTimersByTime(300);

    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  test('session absent from the loaded list does not invalidate', () => {
    const part = makeToolPart('edit', 'completed');
    handlePartUpdated({ type: 'part.updated', sessionId: 'sess-1', part }, makeCtx());
    vi.advanceTimersByTime(300);

    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
