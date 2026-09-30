import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session, SessionHarnessState } from '@prokopai/sdk';
import { ChatView } from '@/components/chat/ChatView';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';

vi.mock('@/components/chat/DeferredConversation', () => ({
  DeferredConversation: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/chat/VirtualizedTranscript', () => ({
  VirtualizedTranscript: ({ compactedAfterMessageId, isCompacting }: {
    compactedAfterMessageId?: string; isCompacting?: boolean;
  }) => <div data-testid="transcript" data-marker={compactedAfterMessageId} data-busy={String(isCompacting)} />,
}));
vi.mock('@/components/chat/MessageInput', () => ({
  MessageInput: ({ disabled }: { disabled?: boolean }) => <input aria-label="message" disabled={disabled} />,
}));
vi.mock('@/components/chat/EmptySessionCheckout', () => ({ EmptySessionCheckout: () => null }));
vi.mock('@/components/chat/RetryStatus', () => ({ RetryStatus: () => null }));
vi.mock('@/hooks/useTranscriptPagination', () => ({ useTranscriptPagination: () => ({ loadOlder: () => {} }) }));
afterEach(() => {
  cleanup();
  usePendingOperationsStore.setState({ operations: [] });
});

function view(harness: 'claude-cli' | 'codex-cli', pending: boolean, marker?: string) {
  // Wire shape: the server derives harnessState from these same metadata
  // keys; the fixture mirrors the derivation for the inputs it uses.
  const harnessState: SessionHarnessState = harness === 'claude-cli'
    ? {
      compaction: { pending: false, uncertain: pending, boundaryMessageId: marker ?? null },
      fork: { mode: 'any' }, goal: null, usage: null, goalUncertain: false, nativeApprovalPrefix: 'claude-approval:',
      capabilities: { canRemoveQueuedMessages: true, canInterruptSubagent: false, subagentActivityPropagates: false },
    }
    : {
      compaction: { pending, uncertain: false, boundaryMessageId: marker ?? null },
      fork: { mode: 'assistant-only' }, goal: null, usage: null, goalUncertain: false, nativeApprovalPrefix: 'codex-approval:',
      capabilities: { canRemoveQueuedMessages: false, canInterruptSubagent: true, subagentActivityPropagates: true },
    };
  const session: Session = { id: 's', workspaceId: 'ws', status: 'active', harness, parentId: null,
    preconfigId: null, title: 'Test', createdAt: '2026-01-01', updatedAt: '2026-01-01', agentName: null,
    metadata: null, harnessState };
  return <ChatView session={session} messagesWithParts={[]} queuedMessages={[]}
    pendingAskRequests={[]} onAskResponse={() => {}} onRemoveFromQueue={() => {}}
    onSendMessage={() => {}} />;
}

test.each(['claude-cli', 'codex-cli'] as const)('%s pending compaction locks input and keeps its marker', (harness) => {
  const rendered = render(view(harness, true, 'last-message'));
  expect(screen.getByTestId('transcript')).toHaveAttribute('data-marker', 'last-message');
  expect(screen.getByTestId('transcript')).toHaveAttribute('data-busy', String(harness === 'codex-cli'));
  expect(screen.getByRole('textbox', { name: 'message' })).toBeDisabled();
  if (harness === 'claude-cli') expect(screen.getByRole('alert')).toHaveTextContent('outcome unknown');
  rendered.rerender(view(harness, false, 'last-message'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'message' })).toBeEnabled();
  expect(screen.getByTestId('transcript')).toHaveAttribute('data-marker', 'last-message');
});

test('Claude command in flight shows progress, then unresolved outcome shows a lock', () => {
  usePendingOperationsStore.getState().startOperation({ type: 'compact', sessionId: 's', startedAt: Date.now() });
  render(view('claude-cli', true));
  expect(screen.getByTestId('transcript')).toHaveAttribute('data-busy', 'true');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  act(() => usePendingOperationsStore.getState().clearOperation('s', 'compact'));
  expect(screen.getByTestId('transcript')).toHaveAttribute('data-busy', 'false');
  expect(screen.getByRole('alert')).toHaveTextContent('outcome unknown');
});
