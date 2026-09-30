import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session, SessionHarnessState } from '@prokopai/sdk';
import { useSidebarData } from '@/hooks/useSidebarData';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useAskStore } from '@/stores/askStore';

const route = vi.hoisted(() => ({ sessionId: 'parent' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ sessionId: route.sessionId }) }));
vi.mock('@/contexts/ServerContext', () => ({ useServerContext: () => ({ servers: [], quickConnections: [] }) }));

// Codex wire shape: the server derives this state from the persisted
// harness; fixtures mirror it so the hook reads what production sends.
const codexHarnessState: SessionHarnessState = {
  compaction: { pending: false, uncertain: false, boundaryMessageId: null },
  fork: { mode: 'assistant-only' },
  goalUncertain: false,
  nativeApprovalPrefix: 'codex-approval:',
  capabilities: { canRemoveQueuedMessages: false, canInterruptSubagent: true, subagentActivityPropagates: true },
};

function session(id: string, overrides: Partial<Session> = {}): Session {
  return { id, workspaceId: 'ws', title: id, status: 'active', parentId: null,
    harness: 'codex-cli', harnessState: codexHarnessState, metadata: null, tags: [], ...overrides } as Session;
}

afterEach(() => {
  act(() => {
    useSessionStore.getState().clearSessions();
    useConnectionStore.getState().clearStreamingSessions();
    useAskStore.getState().clearPendingRequests();
    route.sessionId = 'parent';
  });
});

test('parent stays running while viewing a child, including after its own turn ends', () => {
  act(() => {
    useSessionStore.getState().setSessions([
      session('parent'), session('child', { parentId: 'parent', subagentStatus: 'completed' }),
    ]);
    useConnectionStore.getState().addStreamingSession('parent');
  });
  const { result, rerender } = renderHook(() => useSidebarData());
  expect(result.current.sessionDerivedValues.get('parent')?.isRunning).toBe(true);
  act(() => { route.sessionId = 'child'; });
  rerender();
  expect(result.current.sessionDerivedValues.get('parent')?.isRunning).toBe(true);
  act(() => useSessionStore.getState().mergeSessions([
    session('child', { parentId: 'parent', subagentStatus: 'running' }),
  ]));
  act(() => useConnectionStore.getState().removeStreamingSession('parent'));
  expect(result.current.sessionDerivedValues.get('parent')?.isRunning).toBe(true);
  act(() => useSessionStore.getState().mergeSessions([
    session('child', { parentId: 'parent', subagentStatus: 'completed' }),
  ]));
  expect(result.current.sessionDerivedValues.get('parent')?.isRunning).toBe(false);
});

test('child approval flags both child and parent while preserving the controlling session', () => {
  act(() => {
    useSessionStore.getState().setSessions([
      session('parent'), session('child', { parentId: 'parent', subagentStatus: 'running' }),
    ]);
    useAskStore.getState().addPendingRequest({ sessionId: 'parent', originSessionId: 'child',
      toolCallId: 'codex-approval:1', requestId: 'request-1', toolName: 'codex-cli:command',
      ask: { type: 'permission', question: 'Allow?', resource: 'shell-command', action: 'execute', risk: 'high' },
    });
  });
  const { result } = renderHook(() => useSidebarData());
  expect(result.current.sessionDerivedValues.get('parent')?.hasPendingPermission).toBe(true);
  expect(result.current.sessionDerivedValues.get('child')?.hasPendingPermission).toBe(true);
});
