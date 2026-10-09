import { describe, expect, test } from 'bun:test';
import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { createClientSendRegistry } from '@/application/sessions/client-sends';

type Sent = { to: string; message: ServerMessage };

function fakeWire(): { wire: SessionWirePorts<string>; sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    sent,
    wire: {
      actor: { attachOriginToSession: () => {} },
      delivery: {
        send: (origin, message) => { sent.push({ to: origin, message }); },
        broadcast: message => { sent.push({ to: '*', message }); },
        broadcastToSession: (sessionId, message) => { sent.push({ to: `session:${sessionId}`, message }); },
        sendToController: (sessionId, message) => { sent.push({ to: `controller:${sessionId}`, message }); },
        sendToAskTargets: (sessionId, _authority, message) => { sent.push({ to: `ask:${sessionId}`, message }); },
      },
    },
  };
}

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const userCreated: ServerMessage = {
  type: 'message.created',
  message: { id: 'server-message', sessionId: 's1', role: 'user', createdAt: 1 },
};

describe('client send tracking', () => {
  test('the first user message accepts the prompt, and the sender hears it before the message', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', ID)!;

    tracked.wire.delivery.broadcastToSession('s1', userCreated);
    tracked.finish();

    expect(sent.map(entry => [entry.to, entry.message.type])).toEqual([
      ['origin', 'chat.accepted'],
      ['session:s1', 'message.created'],
    ]);
    expect(sent[0].message).toEqual({ type: 'chat.accepted', sessionId: 's1', clientMessageId: ID, messageId: 'server-message' });
  });

  test('a queued prompt is accepted with its queue id', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', ID)!;

    tracked.wire.delivery.send('origin', {
      type: 'queue.added', sessionId: 's1',
      message: { id: 'queue-1', sessionId: 's1', content: 'hi', position: 0, createdAt: 1 },
    });

    expect(sent[0].message).toMatchObject({ type: 'chat.accepted', queueId: 'queue-1' });
    expect(sent[1].message.type).toBe('queue.added');
  });

  test('an error before acceptance becomes a rejection of that prompt instead of a generic error', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', ID)!;

    tracked.wire.delivery.send('origin', { type: 'error', code: 'invalid_session', message: 'CLI turn already running', sessionId: 's1' });
    tracked.finish();

    expect(sent).toEqual([{ to: 'origin', message: {
      type: 'chat.rejected', sessionId: 's1', clientMessageId: ID, code: 'invalid_session', message: 'CLI turn already running',
    } }]);
  });

  test('errors after acceptance belong to the turn and pass through unchanged', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', ID)!;
    tracked.wire.delivery.broadcastToSession('s1', userCreated);

    tracked.wire.delivery.send('origin', { type: 'error', code: 'provider', message: 'boom', sessionId: 's1' });

    expect(sent.at(-1)?.message).toMatchObject({ type: 'error', message: 'boom' });
  });

  test('a controller rejection still updates control state and rejects the prompt', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', ID)!;

    tracked.wire.delivery.send('origin', {
      type: 'session.action_rejected', sessionId: 's1', action: 'chat.message', code: 'not_controller',
      message: 'Another client is in control', control: { sessionId: 's1', status: 'uncontrolled' },
    } as ServerMessage);

    expect(sent.map(entry => entry.message.type)).toEqual(['session.action_rejected', 'chat.rejected']);
  });

  test('a send that ends without persisting anything is rejected, not left pending', () => {
    const { wire, sent } = fakeWire();
    createClientSendRegistry().track(wire, 'origin', 's1', ID)!.finish();
    expect(sent[0].message).toMatchObject({ type: 'chat.rejected', code: 'not_accepted' });
  });

  test('retrying an accepted prompt answers from the record and does not send it again', () => {
    const registry = createClientSendRegistry();
    const first = fakeWire();
    const tracked = registry.track(first.wire, 'origin', 's1', ID)!;
    tracked.wire.delivery.broadcastToSession('s1', userCreated);

    const retry = fakeWire();
    expect(registry.track(retry.wire, 'reconnected', 's1', ID)).toBeNull();
    expect(retry.sent).toEqual([{ to: 'reconnected', message: {
      type: 'chat.accepted', sessionId: 's1', clientMessageId: ID, messageId: 'server-message',
    } }]);
  });

  test('a retry while the first attempt is still in flight is ignored; a rejected prompt may retry', () => {
    const registry = createClientSendRegistry();
    const first = registry.track(fakeWire().wire, 'origin', 's1', ID)!;
    expect(registry.track(fakeWire().wire, 'origin', 's1', ID)).toBeNull();

    first.finish();
    expect(registry.track(fakeWire().wire, 'origin', 's1', ID)).not.toBeNull();
  });

  test('sends without a valid id keep today\'s behavior', () => {
    const { wire, sent } = fakeWire();
    const tracked = createClientSendRegistry().track(wire, 'origin', 's1', 'not valid!')!;
    tracked.wire.delivery.send('origin', { type: 'error', code: 'x', message: 'y' });
    tracked.finish();
    expect(sent).toEqual([{ to: 'origin', message: { type: 'error', code: 'x', message: 'y' } }]);
  });
});
