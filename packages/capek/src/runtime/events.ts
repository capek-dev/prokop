import type { Ask } from '@capekai/tool'
import type { AskAuthority, AssistantMessage, Message, MessageWithParts, Part, QueuedMessage, Session } from '@capekai/types';
import type { UsageEventData } from '../core/step-handlers';

export type RuntimeEvent =
  | { kind: 'message'; action: 'created' | 'updated'; message: Message }
  | { kind: 'part'; action: 'created' | 'updated'; sessionId: string; part: Part }
  | { kind: 'part'; action: 'append'; sessionId: string; partId: string; field: 'text' | 'reasoning'; delta: string }
  | { kind: 'session'; action: 'created' | 'updated' | 'renamed'; session: Session }
  | { kind: 'session'; action: 'state'; sessionId: string; messages: MessageWithParts[] }
  | { kind: 'usage'; sessionId: string; usage: UsageEventData; model: string; variant?: string }
  | {
    kind: 'retry';
    sessionId: string;
    status: 'scheduled' | 'started' | 'exhausted' | 'cancelled';
    attempt: number;
    maxAttempts: number;
    errorType: 'rate_limit' | 'server_error' | 'timeout' | 'network';
    message: string;
    delayMs?: number;
    retryAt?: number;
  }
  | { kind: 'failure'; category: 'generic'; code: string; message: string; sessionId?: string }
  | { kind: 'failure'; category: 'rate_limit'; code: 'rate_limit'; message: string; sessionId?: string; retryAfterMs: number }
  | { kind: 'failure'; category: 'server'; code: 'server_error'; message: string; sessionId?: string; retryAfterMs?: number }
  | { kind: 'failure'; category: 'timeout'; code: 'timeout'; message: string; sessionId?: string; retryAfterMs?: number }
  | { kind: 'queue'; action: 'added'; sessionId: string; message: QueuedMessage }
  | { kind: 'queue'; action: 'sending'; sessionId: string; queueId: string }
  | {
    kind: 'ask';
    action: 'requested';
    sessionId: string;
    toolCallId: string;
    toolName: string;
    ask: Ask;
    requestId?: string;
    authority?: AskAuthority;
  }
  | { kind: 'ask'; action: 'timed_out'; sessionId: string; toolCallId: string; requestId?: string }
  | { kind: 'terminal'; message: AssistantMessage; sessionId: string };

export type RuntimeAudience<Origin = unknown> =
  | { scope: 'global' }
  | { scope: 'session'; sessionId: string }
  | { scope: 'origin'; origin: Origin }
  | { scope: 'controller'; sessionId: string }
  | { scope: 'ask_targets'; sessionId: string; authority: AskAuthority }
  | { scope: 'host' };

export interface RuntimeDelivery<Origin = unknown> {
  audience: RuntimeAudience<Origin>;
  event: RuntimeEvent;
}

export type RuntimeEventSink = (event: RuntimeEvent) => void;

export interface RuntimeEventContext<Origin = unknown> {
  emit(delivery: RuntimeDelivery<Origin>): void;
  observe?(delivery: RuntimeDelivery<Origin>): void;
  attachOriginToSession(origin: Origin, sessionId: string): void;
}
