import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

/** Client ids are UUIDs; anything else is ignored and the send is untracked. */
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9-]{8,64}$/;
/** Enough to cover retries after a reconnect; older ids are forgotten. */
const REMEMBERED_SENDS = 500;

type SendOutcome =
  | { status: 'pending' }
  | { status: 'accepted'; messageId?: string; queueId?: string }
  | { status: 'rejected' };

export interface TrackedSend<Origin> {
  wire: SessionWirePorts<Origin>;
  /** Rejects the prompt if the send settled without persisting it. */
  finish(): void;
}

export interface ClientSendRegistry {
  /**
   * Wraps a prompt send so its sender learns the outcome by id: the first
   * user message created in the session (or the queue item stored for it)
   * accepts it, and any error the sender gets before that rejects it.
   * Returns null for a duplicate that must not run again.
   */
  track<Origin>(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    sessionId: string,
    clientMessageId: string | undefined,
  ): TrackedSend<Origin> | null;
}

export function createClientSendRegistry(): ClientSendRegistry {
  const outcomes = new Map<string, SendOutcome>();

  const remember = (id: string, outcome: SendOutcome): void => {
    outcomes.delete(id);
    outcomes.set(id, outcome);
    if (outcomes.size > REMEMBERED_SENDS) {
      const oldest = outcomes.keys().next().value;
      if (oldest !== undefined) outcomes.delete(oldest);
    }
  };

  return {
    track(wire, origin, sessionId, clientMessageId) {
      if (!clientMessageId || !CLIENT_MESSAGE_ID.test(clientMessageId)) {
        return { wire, finish: () => {} };
      }
      const delivery = wire.delivery;
      const previous = outcomes.get(clientMessageId);
      // A retry after a lost connection: answer from the record, never persist twice.
      if (previous?.status === 'pending') return null;
      if (previous?.status === 'accepted') {
        delivery.send(origin, {
          type: 'chat.accepted', sessionId, clientMessageId,
          ...(previous.messageId && { messageId: previous.messageId }),
          ...(previous.queueId && { queueId: previous.queueId }),
        });
        return null;
      }

      let state: SendOutcome['status'] = 'pending';
      remember(clientMessageId, { status: 'pending' });

      const accept = (ids: { messageId?: string; queueId?: string }): void => {
        if (state !== 'pending') return;
        state = 'accepted';
        remember(clientMessageId, { status: 'accepted', ...ids });
        // Ahead of the persisted message, so the sender never shows both.
        delivery.send(origin, { type: 'chat.accepted', sessionId, clientMessageId, ...ids });
      };
      const reject = (code: string, message: string): void => {
        if (state !== 'pending') return;
        state = 'rejected';
        remember(clientMessageId, { status: 'rejected' });
        delivery.send(origin, { type: 'chat.rejected', sessionId, clientMessageId, code, message });
      };

      const tracked: SessionWirePorts<typeof origin> = {
        actor: wire.actor,
        delivery: {
          send(target, message: ServerMessage) {
            if (state === 'pending' && target === origin) {
              if (message.type === 'queue.added' && message.sessionId === sessionId) {
                accept({ queueId: message.message.id });
              } else if (message.type.startsWith('error')) {
                // The prompt's own failure: shown on the prompt instead of as a toast.
                const failure = message as { code?: string; message?: string };
                reject(failure.code ?? 'error', failure.message ?? 'The prompt could not be sent');
                return;
              } else if (message.type === 'session.action_rejected') {
                delivery.send(target, message);
                reject(message.code, message.message);
                return;
              }
            }
            delivery.send(target, message);
          },
          broadcast: (message, excludeOrigin) => delivery.broadcast(message, excludeOrigin),
          broadcastToSession(id, message, excludeOrigin) {
            if (state === 'pending' && id === sessionId && message.type === 'message.created'
              && message.message.role === 'user') {
              accept({ messageId: message.message.id });
            }
            delivery.broadcastToSession(id, message, excludeOrigin);
          },
          sendToController: (id, message) => delivery.sendToController(id, message),
          sendToAskTargets: (id, authority, message) => delivery.sendToAskTargets(id, authority, message),
        },
      };

      return {
        wire: tracked,
        finish: () => reject('not_accepted', 'The prompt was not accepted. Try sending it again.'),
      };
    },
  };
}

/** One registry per server process, shared by direct sends and queue adds so retries dedupe across both. */
export const clientSends = createClientSendRegistry();
