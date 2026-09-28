import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import { ChatView } from '@/components/chat/ChatView';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import type { PendingAskRequest } from '@/stores/askStore';

vi.mock('@/components/chat/VirtualizedTranscript', () => ({ VirtualizedTranscript: () => null }));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: () => null }));
vi.mock('@/components/chat/DeferredConversation', () => ({ DeferredConversation: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/chat/AskQuestion', () => ({ AskQuestion: ({ request }: { request: PendingAskRequest }) =>
  <span data-testid="codex-ask">{request.toolCallId}</span> }));
vi.mock('@/hooks/useTranscriptPagination', () => ({ useTranscriptPagination: () => ({ loadOlder: () => {} }) }));

const parent = { id: 'parent', workspaceId: 'ws', harness: 'codex-cli', status: 'active',
  parentId: null, metadata: null } as Session;
const child = { ...parent, id: 'child', parentId: 'parent', subagentStatus: 'running' } as Session;
const pendingAskRequests: PendingAskRequest[] = [{
  sessionId: 'parent', originSessionId: 'child', requestId: 'ask-1', toolCallId: 'codex-approval:1',
  toolName: 'codex-cli:command', ask: { type: 'permission', question: 'Allow child read?',
    resource: 'file', action: 'read', risk: 'high' },
}];

function view(session: Session) {
  return render(<ChatView session={session} messagesWithParts={[]} queuedMessages={[]}
    pendingAskRequests={pendingAskRequests} onAskResponse={() => {}}
    onSendMessage={() => {}} onRemoveFromQueue={() => {}} />);
}

afterEach(() => {
  act(() => {
    useSessionControlStore.setState({ controlBySessionId: {} });
    useClientIdentityStore.setState({ clientId: null });
  });
});

test('the parent controller can see a child approval while viewing either session', () => {
  useClientIdentityStore.setState({ clientId: 'owner' });
  useSessionControlStore.setState({ controlBySessionId: { parent: {
    status: 'controlled', controllerClientId: 'owner', sessionId: 'parent',
  } as never } });
  const parentView = view(parent);
  expect(screen.getAllByTestId('codex-ask')).toHaveLength(1);
  parentView.unmount();
  view(child);
  expect(screen.getAllByTestId('codex-ask')).toHaveLength(1);
});

test('a viewer without parent control cannot answer from the child session', () => {
  useClientIdentityStore.setState({ clientId: 'viewer' });
  useSessionControlStore.setState({ controlBySessionId: { parent: {
    status: 'controlled', controllerClientId: 'owner', sessionId: 'parent',
  } as never } });
  view(child);
  expect(screen.queryByTestId('codex-ask')).not.toBeInTheDocument();
  act(() => useClientIdentityStore.setState({ clientId: null }));
  expect(screen.queryByTestId('codex-ask')).not.toBeInTheDocument();
});
