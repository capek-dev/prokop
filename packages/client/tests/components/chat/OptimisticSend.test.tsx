import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Message, Part, ProkopaiClient, QueuedMessage, Session, Workspace } from '@prokopai/sdk';

vi.mock('@tanstack/react-router', () => ({ useRouterState: () => '/server/studio/workspace' }));
vi.mock('@/lib/hostClientPool', () => ({ foreignClientFor: () => null }));

import { useSessionCommands } from '@/hooks/useSessionCommands';
import { subscribeToServerEvents } from '@/hooks/subscribeToServerEvents';
import { handleMessageCreated, handlePartCreated } from '@/handlers/serverMessage/messagePartHandlers';
import { handleQueueAdded } from '@/handlers/serverMessage/permissionQueueHandlers';
import type { SessionHandlersContext } from '@/handlers/serverMessage';
import { mergePendingSends } from '@/components/chat/ChatView';
import type { DisplayItem } from '@/components/chat/ChatView';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { usePendingSendStore } from '@/stores/pendingSendStore';
import type { PendingSend } from '@/stores/pendingSendStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';

const workspace = { id: 'w', name: 'jean2', path: '/p' } as Workspace;
const idle = { id: 's1', workspaceId: 'w', title: 'Idle', status: 'active' } as Session;
const running = { ...idle, id: 's2', runningAt: new Date().toISOString() } as Session;

function fakeClient(connected = true) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    connected,
    chat: { send: vi.fn() },
    queue: { add: vi.fn() },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    off: vi.fn(),
    emit: (event: string, ...args: unknown[]) => listeners.get(event)?.forEach(handler => handler(...args)),
  };
}
type FakeClient = ReturnType<typeof fakeClient>;

function commands(client: FakeClient) {
  return renderHook(() => useSessionCommands({
    clientRef: { current: client as unknown as ProkopaiClient }, currentSession: idle, sessions: [idle, running],
    workspaces: [workspace], activeWorkspace: workspace, streamingSessionIds: new Set(), primaryPreconfigs: [],
    setActiveWorkspace: vi.fn(), removePendingAskRequest: vi.fn(), removePendingPermissionRequest: vi.fn(),
    clearPendingAskRequestsBySessionId: vi.fn(), clearStreamingSessions: vi.fn(), pendingSessionCreateRef: { current: null },
    partAppendRafRef: { current: null }, pendingPartAppendsRef: { current: new Map() },
    skipFinishSoundSessionIdsRef: { current: new Set() }, navigate: vi.fn(), serverId: 'studio', viewPath: '/workspace',
  })).result.current;
}

const pendingFor = (sessionId: string) => usePendingSendStore.getState().bySession[sessionId] ?? [];

beforeEach(() => {
  usePendingSendStore.setState({ bySession: {} });
  useServerDataStore.setState({ serverId: 'studio', activeWorkspace: workspace, workspaces: [workspace] });
  useSessionStore.setState({ ...useSessionStore.getInitialState(), sessions: [idle, running] });
});
afterEach(cleanup);

describe('sending', () => {
  test('a prompt shows at once and goes out with its id', () => {
    const client = fakeClient();
    commands(client).sendChatMessageForSession('s1', 'Fix the flaky test');

    const [pending] = pendingFor('s1');
    expect(pending).toMatchObject({ content: 'Fix the flaky test', status: 'sending', kind: 'chat' });
    expect(client.chat.send).toHaveBeenCalledWith('s1', 'Fix the flaky test',
      expect.objectContaining({ clientMessageId: pending.id }));
  });

  test('while disconnected the prompt is kept and marked not sent instead of vanishing', () => {
    const client = fakeClient(false);
    commands(client).sendChatMessageForSession('s1', 'Lost words');

    expect(client.chat.send).not.toHaveBeenCalled();
    expect(pendingFor('s1')[0]).toMatchObject({ content: 'Lost words', status: 'failed', error: expect.stringMatching(/Not connected/) });
  });

  test('a prompt for a running session is queued with its id', () => {
    const client = fakeClient();
    commands(client).sendChatMessageForSession('s2', 'After this');

    const [pending] = pendingFor('s2');
    expect(pending.kind).toBe('queue');
    expect(client.queue.add).toHaveBeenCalledWith('s2', 'After this', expect.objectContaining({ clientMessageId: pending.id }));
  });

  test('retry reuses the id so the server can tell it is the same prompt', () => {
    const client = fakeClient(false);
    const run = commands(client);
    run.sendChatMessageForSession('s1', 'Again');
    const id = pendingFor('s1')[0].id;

    client.connected = true;
    run.sendChatMessageForSession('s1', 'Again', undefined, undefined, undefined, { clientMessageId: id });

    expect(pendingFor('s1')).toHaveLength(1);
    expect(pendingFor('s1')[0]).toMatchObject({ id, status: 'sending' });
    expect(client.chat.send).toHaveBeenCalledWith('s1', 'Again', expect.objectContaining({ clientMessageId: id }));
  });
});

describe('server outcome', () => {
  function sent(client: FakeClient) {
    commands(client).sendChatMessageForSession('s1', 'Hello');
    subscribeToServerEvents(client as unknown as ProkopaiClient, { current: null } as never);
    return pendingFor('s1')[0].id;
  }

  test('chat.accepted records the persisted message id', () => {
    const client = fakeClient();
    const id = sent(client);
    client.emit('chat.accepted', { type: 'chat.accepted', sessionId: 's1', clientMessageId: id, messageId: 'm-1' });
    expect(pendingFor('s1')[0]).toMatchObject({ status: 'accepted', messageId: 'm-1' });
  });

  test('chat.rejected keeps the prompt with the reason', () => {
    const client = fakeClient();
    const id = sent(client);
    client.emit('chat.rejected', { type: 'chat.rejected', sessionId: 's1', clientMessageId: id, code: 'invalid_session', message: 'CLI turn already running' });
    expect(pendingFor('s1')[0]).toMatchObject({ status: 'failed', error: 'CLI turn already running' });
  });

  test('losing the connection fails prompts still in flight on it, not accepted ones', () => {
    const client = fakeClient();
    const id = sent(client);
    commands(client).sendChatMessageForSession('s1', 'Second');
    client.emit('chat.accepted', { type: 'chat.accepted', sessionId: 's1', clientMessageId: id, messageId: 'm-1' });

    client.emit('disconnected', { code: 1006 });

    expect(pendingFor('s1').map(send => send.status)).toEqual(['accepted', 'failed']);
  });

  test('the persisted text replaces the optimistic prompt; a stored queue item replaces a queued one', () => {
    usePendingSendStore.getState().begin({ id: 'c1', sessionId: 's1', content: 'a', kind: 'chat' });
    usePendingSendStore.getState().accept('c1', { messageId: 'm-1' });
    usePendingSendStore.getState().begin({ id: 'c2', sessionId: 's1', content: 'b', kind: 'queue' });
    usePendingSendStore.getState().accept('c2', { queueId: 'q-1' });
    const ctx = { setPartsBySession: vi.fn(), partIdIndexRef: { current: new Map() }, clearCompletion: vi.fn(),
      addQueuedMessage: vi.fn() } as unknown as SessionHandlersContext;

    handlePartCreated({ type: 'part.created', sessionId: 's1',
      part: { id: 'p', messageId: 'm-1', createdAt: 1, type: 'text', text: 'a' } }, ctx);
    expect(pendingFor('s1').map(send => send.id)).toEqual(['c2']);

    handleQueueAdded({ type: 'queue.added', sessionId: 's1', message: { id: 'q-1' } as QueuedMessage }, ctx);
    expect(pendingFor('s1')).toEqual([]);
  });
});

describe('machines on an older server', () => {
  const ctx = { setMessagesBySession: vi.fn(), setPartsBySession: vi.fn(), addStreamingSession: vi.fn(),
    removeInterruptedSession: vi.fn(), clearCompletion: vi.fn() } as unknown as SessionHandlersContext;
  const userMessage = (id: string) => ({ type: 'message.created' as const,
    message: { id, sessionId: 's1', role: 'user', createdAt: 1 } as Message });

  test('without chat.accepted, the persisted prompt settles the one in flight', () => {
    const client = fakeClient();
    commands(client).sendChatMessageForSession('s1', 'Hello');

    handleMessageCreated(userMessage('m-legacy'), ctx);

    expect(pendingFor('s1')[0]).toMatchObject({ status: 'accepted', messageId: 'm-legacy' });
  });

  test('a server that answers by id is never second-guessed by the fallback', () => {
    const client = fakeClient();
    subscribeToServerEvents(client as unknown as ProkopaiClient, { current: null } as never);
    const run = commands(client);
    run.sendChatMessageForSession('s1', 'First');
    const first = pendingFor('s1')[0].id;
    client.emit('chat.accepted', { type: 'chat.accepted', sessionId: 's1', clientMessageId: first, messageId: 'm-1' });
    run.sendChatMessageForSession('s1', 'Second');

    handleMessageCreated(userMessage('m-1'), ctx);

    expect(pendingFor('s1')[1]).toMatchObject({ content: 'Second', status: 'sending' });
  });
});

describe('transcript merge', () => {
  const send = (overrides: Partial<PendingSend>): PendingSend => ({
    id: 'c1', sessionId: 's1', content: 'Hello', kind: 'chat', status: 'sending', createdAt: 5, ...overrides,
  });
  const persisted = (parts: Part[]): DisplayItem => ({
    message: { id: 'm-1', sessionId: 's1', role: 'user', createdAt: 4 } as Message, parts,
  });

  test('an unconfirmed prompt follows the transcript as a user message', () => {
    const [item] = mergePendingSends([], [send({})]);
    expect(item.message).toMatchObject({ id: 'c1', role: 'user' });
    expect(item.parts).toEqual([expect.objectContaining({ type: 'text', text: 'Hello' })]);
    expect(item.pendingSend?.status).toBe('sending');
  });

  test('once persisted it lends its text until the real text arrives, and never shows twice', () => {
    const accepted = send({ status: 'accepted', messageId: 'm-1' });
    const lent = mergePendingSends([persisted([])], [accepted]);
    expect(lent).toHaveLength(1);
    expect(lent[0].parts).toEqual([expect.objectContaining({ type: 'text', text: 'Hello' })]);

    const real: Part = { id: 'p', messageId: 'm-1', createdAt: 4, type: 'text', text: 'Hello' };
    expect(mergePendingSends([persisted([real])], [accepted])[0].parts).toEqual([real]);
  });

  test('an accepted prompt that has not arrived yet already uses its persisted id as row key', () => {
    expect(mergePendingSends([], [send({ status: 'accepted', messageId: 'm-1' })])[0].message.id).toBe('m-1');
  });
});

describe('prompt status under the bubble', () => {
  const user = { id: 'c1', sessionId: 's1', role: 'user', createdAt: 1 } as Message;

  test('a failed prompt says why and offers Retry, Edit and Discard without hover', () => {
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    const onDiscard = vi.fn();
    render(<MessageBubble message={user} sendStatus="failed" sendError="Not connected."
      onRetrySend={onRetry} onEditSend={onEdit} onDiscardSend={onDiscard}>Hi</MessageBubble>);

    expect(screen.getByRole('alert')).toHaveTextContent('Not sent: Not connected.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect([onRetry, onEdit, onDiscard].every(fn => fn.mock.calls.length === 1)).toBe(true);
  });

  test('a prompt in flight shows a delayed Sending mark; an accepted one shows nothing', () => {
    const view = render(<MessageBubble message={user} sendStatus="sending">Hi</MessageBubble>);
    expect(screen.getByText('Sending')).toBeInTheDocument();
    view.rerender(<MessageBubble message={user} sendStatus="accepted">Hi</MessageBubble>);
    expect(screen.queryByText('Sending')).not.toBeInTheDocument();
  });
});
