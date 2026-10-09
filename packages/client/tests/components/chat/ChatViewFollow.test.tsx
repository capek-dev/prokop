import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { MessageWithParts, Session } from '@prokopai/sdk';
import { ChatView } from '@/components/chat/ChatView';
import type { SessionNavigationIntent } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/sessionStore';
import type { TranscriptAnchor } from '@/lib/transcriptFollow';

interface TranscriptProps {
  autoFollow: boolean;
  initialAnchor?: TranscriptAnchor;
  onAutoScrollChange: (enabled: boolean) => void;
  onSavePosition: (anchor: TranscriptAnchor | null) => void;
}

const { transcript } = vi.hoisted(() => ({ transcript: { props: null as TranscriptProps | null } }));
vi.mock('@/components/chat/VirtualizedTranscript', () => ({
  VirtualizedTranscript: (props: TranscriptProps) => { transcript.props = props; return null; },
}));
vi.mock('@/components/chat/DeferredConversation', () => ({
  DeferredConversation: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/chat/MessageInput', () => ({ MessageInput: () => null }));
vi.mock('@/components/chat/PendingAskDock', () => ({ PendingAskDock: () => null }));
vi.mock('@/components/chat/RetryStatus', () => ({ RetryStatus: () => null }));
vi.mock('@/components/chat/UserPromptMap', () => ({ UserPromptMap: () => null }));
vi.mock('@/hooks/useTranscriptPagination', () => ({ useTranscriptPagination: () => ({ loadOlder: vi.fn() }) }));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ navigationIntentBySessionId: {} });
});

const session = { id: 'chat-1', status: 'active', workspaceId: 'w' } as Session;
const messages: MessageWithParts[] = ['m1', 'm2'].map((id, index) => ({
  message: { id, sessionId: 'chat-1', createdAt: index, role: 'user' },
  parts: [],
}));

function view(navigationIntent: SessionNavigationIntent, extra: { messages?: MessageWithParts[]; isStreaming?: boolean } = {}) {
  return (
    <ChatView
      session={session}
      messagesWithParts={extra.messages ?? messages}
      queuedMessages={[]}
      pendingAskRequests={[]}
      onSendMessage={vi.fn()}
      onRemoveFromQueue={vi.fn()}
      onAskResponse={vi.fn()}
      navigationIntent={navigationIntent}
      isStreaming={extra.isStreaming}
    />
  );
}

test('following shows no control; leaving it shows Latest, with a dot once new output arrives', () => {
  const rendered = render(view({ mode: 'follow' }));
  expect(screen.queryByRole('button', { name: /Latest/ })).not.toBeInTheDocument();

  act(() => transcript.props!.onAutoScrollChange(false));
  expect(screen.getByRole('button', { name: /Latest/ })).toBeInTheDocument();
  expect(screen.queryByTestId('unseen-output')).not.toBeInTheDocument();

  const more = [...messages, { message: { id: 'm3', sessionId: 'chat-1', createdAt: 3, role: 'assistant' }, parts: [] }] as MessageWithParts[];
  rendered.rerender(view({ mode: 'follow' }, { messages: more }));
  expect(screen.getByTestId('unseen-output')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Latest/ }));
  expect(transcript.props!.autoFollow).toBe(true);
  expect(screen.queryByRole('button', { name: /Latest/ })).not.toBeInTheDocument();
});

test('a streaming agent marks the Latest control as having unseen output', () => {
  render(view({ mode: 'free', anchor: { messageId: 'm1', offset: 0 } }, { isStreaming: true }));
  expect(screen.getByTestId('unseen-output')).toBeInTheDocument();
});

test('a saved reading position reopens in free mode at that position', () => {
  render(view({ mode: 'free', anchor: { messageId: 'm1', offset: 40 } }));
  expect(transcript.props!.autoFollow).toBe(false);
  expect(transcript.props!.initialAnchor).toEqual({ messageId: 'm1', offset: 40 });
});

test('free mode without a loaded anchor follows instead of opening at the top', () => {
  render(view({ mode: 'free', anchor: { messageId: 'not-loaded', offset: 0 } }));
  expect(transcript.props!.autoFollow).toBe(true);
  expect(transcript.props!.initialAnchor).toBeUndefined();
});

test('the transcript saves its position into the session navigation intent', () => {
  render(view({ mode: 'follow' }));
  act(() => transcript.props!.onSavePosition({ messageId: 'm2', offset: 12 }));
  expect(useSessionStore.getState().getNavigationIntentForSession('chat-1'))
    .toEqual({ mode: 'free', anchor: { messageId: 'm2', offset: 12 } });

  act(() => transcript.props!.onSavePosition(null));
  expect(useSessionStore.getState().getNavigationIntentForSession('chat-1')).toEqual({ mode: 'follow' });
});
