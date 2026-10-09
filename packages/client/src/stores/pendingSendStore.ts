import { create } from 'zustand';
import type { AttachmentKind } from '@prokopai/sdk';

export type PendingSendStatus = 'sending' | 'accepted' | 'failed';

export interface PendingSendGoal {
  condition: string;
  maxTurns?: number;
  tokenBudget?: number;
}

/**
 * A prompt shown before the server persists it. `messageId` / `queueId`
 * arrive with `chat.accepted`; the entry is dropped once the persisted
 * message has its text or the queue item exists.
 */
export interface PendingSend {
  id: string;
  sessionId: string;
  content: string;
  attachments?: Array<{ id: string; kind: AttachmentKind }>;
  responseFormatId?: string;
  goal?: PendingSendGoal;
  kind: 'chat' | 'queue';
  status: PendingSendStatus;
  createdAt: number;
  messageId?: string;
  queueId?: string;
  error?: string;
  /** The connection it went out on; losing it fails sends still in flight. */
  connection?: object;
}

/**
 * Connections whose server has answered a prompt by id. Their prompts are
 * settled only by that answer, never by the fallback for older servers,
 * which could pair a quick second prompt with the first one's message.
 */
const ackingConnections = new WeakSet<object>();

export function markConnectionAcksPrompts(connection: object): void {
  ackingConnections.add(connection);
}

interface PendingSendState {
  bySession: Record<string, PendingSend[]>;
  begin: (send: Omit<PendingSend, 'status' | 'createdAt' | 'messageId' | 'queueId' | 'error'>) => void;
  accept: (id: string, ids: { messageId?: string; queueId?: string }) => void;
  fail: (id: string, error: string) => void;
  remove: (id: string) => void;
  removeWhere: (sessionId: string, match: (send: PendingSend) => boolean) => void;
  failInFlight: (connection: object, error: string) => void;
  /**
   * For servers without `chat.accepted` (another machine on an older
   * version): the first persisted prompt settles the oldest one in flight.
   * Current servers accept before persisting, so nothing is in flight then.
   */
  settleOldestInFlight: (sessionId: string, kind: PendingSend['kind'] | 'any', ids: { messageId?: string; queueId?: string }) => void;
  get: (id: string) => PendingSend | undefined;
}

function update(
  bySession: Record<string, PendingSend[]>,
  id: string,
  change: (send: PendingSend) => PendingSend | null,
): Record<string, PendingSend[]> {
  for (const [sessionId, sends] of Object.entries(bySession)) {
    const index = sends.findIndex(send => send.id === id);
    if (index < 0) continue;
    const next = change(sends[index]);
    const updated = next
      ? sends.map((send, i) => (i === index ? next : send))
      : sends.filter((_, i) => i !== index);
    return { ...bySession, [sessionId]: updated };
  }
  return bySession;
}

export const usePendingSendStore = create<PendingSendState>((set, get) => ({
  bySession: {},

  begin: (send) => set(state => {
    // A retry reuses the id: replace the failed entry in place.
    const without = update(state.bySession, send.id, () => null);
    const entry: PendingSend = { ...send, status: 'sending', createdAt: Date.now() };
    return { bySession: { ...without, [send.sessionId]: [...(without[send.sessionId] ?? []), entry] } };
  }),

  accept: (id, ids) => set(state => ({
    bySession: update(state.bySession, id, send => ({ ...send, status: 'accepted', error: undefined, ...ids })),
  })),

  fail: (id, error) => set(state => ({
    bySession: update(state.bySession, id, send =>
      send.status === 'accepted' ? send : { ...send, status: 'failed', error }),
  })),

  remove: (id) => set(state => ({ bySession: update(state.bySession, id, () => null) })),

  removeWhere: (sessionId, match) => set(state => {
    const sends = state.bySession[sessionId];
    if (!sends?.some(match)) return state;
    return { bySession: { ...state.bySession, [sessionId]: sends.filter(send => !match(send)) } };
  }),

  failInFlight: (connection, error) => set(state => {
    let changed = false;
    const bySession: Record<string, PendingSend[]> = {};
    for (const [sessionId, sends] of Object.entries(state.bySession)) {
      bySession[sessionId] = sends.map(send => {
        if (send.status !== 'sending' || send.connection !== connection) return send;
        changed = true;
        return { ...send, status: 'failed', error };
      });
    }
    return changed ? { bySession } : state;
  }),

  settleOldestInFlight: (sessionId, kind, ids) => {
    const oldest = get().bySession[sessionId]?.find(send => send.status === 'sending'
      && (kind === 'any' || send.kind === kind)
      && !(send.connection && ackingConnections.has(send.connection)));
    if (oldest) get().accept(oldest.id, ids);
  },

  get: (id) => Object.values(get().bySession).flat().find(send => send.id === id),
}));

/** Extra send options; `clientMessageId` is set when retrying a failed prompt. */
export interface SendChatOptions {
  clientMessageId?: string;
}
