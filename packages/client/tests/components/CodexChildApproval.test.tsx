import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import { ChatView } from '@/components/chat/ChatView';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import type { PendingAskRequest } from '@/stores/askStore';

vi.mock('@/components/chat/VirtualizedTranscript', () => ({ VirtualizedTranscript: () => null }));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: () => null }));
vi.mock('@/components/chat/DeferredConversation', () => ({ DeferredConversation: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/chat/AskQuestion', () => ({ AskQuestion: ({ request, onRespond }: {
  request: PendingAskRequest;
  onRespond: (toolCallId: string, response: { type: 'permission'; grant: 'once' }, requestId?: string) => void;
}) => <button data-testid="codex-ask" onClick={() => onRespond(request.toolCallId,
  { type: 'permission', grant: 'once' }, request.requestId)}>{request.toolCallId}</button> }));
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

test('the Claude controller sees pending approval in the chat panel, observers do not', () => {
  const claude = { ...parent, id: 'claude', harness: 'claude-cli' } as Session;
  const approval: PendingAskRequest = {
    sessionId: 'claude', requestId: 'claude-ask-1', toolCallId: 'claude-approval:1',
    toolName: 'claude-cli:Bash', ask: { type: 'permission', question: 'Allow Claude to use Bash?',
      resource: 'shell-command', action: 'execute', risk: 'critical', allowedScopes: ['once'] },
  };
  useClientIdentityStore.setState({ clientId: 'owner' });
  useSessionControlStore.setState({ controlBySessionId: { claude: {
    status: 'controlled', controllerClientId: 'owner', sessionId: 'claude',
  } as never } });
  const onAskResponse = vi.fn();
  const owner = render(<ChatView session={claude} messagesWithParts={[]} queuedMessages={[]}
    pendingAskRequests={[approval]} onAskResponse={onAskResponse}
    onSendMessage={() => {}} onRemoveFromQueue={() => {}} />);
  expect(screen.getByTestId('codex-ask')).toHaveTextContent('claude-approval:1');
  fireEvent.click(screen.getByTestId('codex-ask'));
  expect(onAskResponse).toHaveBeenCalledWith('claude-approval:1',
    { type: 'permission', grant: 'once' }, 'claude-ask-1');
  owner.unmount();
  act(() => useClientIdentityStore.setState({ clientId: 'viewer' }));
  render(<ChatView session={claude} messagesWithParts={[]} queuedMessages={[]}
    pendingAskRequests={[approval]} onAskResponse={() => {}}
    onSendMessage={() => {}} onRemoveFromQueue={() => {}} />);
  expect(screen.queryByTestId('codex-ask')).not.toBeInTheDocument();
});

test('Claude child approval is visible from both timelines only to the parent controller', () => {
  const claudeParent = { ...parent, harness: 'claude-cli' } as Session;
  const claudeChild = { ...child, harness: 'claude-cli' } as Session;
  const requests = [{ ...pendingAskRequests[0]!, toolCallId: 'claude-approval:1' }];
  useClientIdentityStore.setState({ clientId: 'owner' });
  useSessionControlStore.setState({ controlBySessionId: { parent: {
    status: 'controlled', controllerClientId: 'owner', sessionId: 'parent',
  } as never } });
  const props = { messagesWithParts: [], queuedMessages: [], pendingAskRequests: requests,
    onAskResponse: () => {}, onSendMessage: () => {}, onRemoveFromQueue: () => {} };
  const parentView = render(<ChatView session={claudeParent} {...props} />);
  expect(screen.getByTestId('codex-ask')).toBeInTheDocument();
  parentView.unmount();
  render(<ChatView session={claudeChild} {...props} />);
  expect(screen.getByTestId('codex-ask')).toBeInTheDocument();
  act(() => useClientIdentityStore.setState({ clientId: 'viewer' }));
  expect(screen.queryByTestId('codex-ask')).not.toBeInTheDocument();
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
