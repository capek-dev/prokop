import type { RuntimeDelivery, RuntimeEvent, RuntimeEventContext } from '@capekai/core';
import type { AskAuthority, ServerMessage } from '@jean2/sdk';
import type { NotificationsApplication } from '@/application/notifications';
import {
  broadcastEvent,
  broadcastToSessionEvent,
  sendToAskTargetsEvent,
  sendToControllerEvent,
} from '@/core/broadcast';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';

export function mapCapekEventToServerMessage(event: RuntimeEvent): ServerMessage | null {
  switch (event.kind) {
    case 'message':
      return { type: event.action === 'created' ? 'message.created' : 'message.updated', message: event.message };
    case 'part':
      if (event.action === 'append') {
        return {
          type: 'part.append',
          sessionId: event.sessionId,
          partId: event.partId,
          field: event.field,
          delta: event.delta,
        };
      }
      return {
        type: event.action === 'created' ? 'part.created' : 'part.updated',
        sessionId: event.sessionId,
        part: event.part,
      };
    case 'session':
      if (event.action === 'state') {
        return { type: 'session.state', sessionId: event.sessionId, messages: event.messages };
      }
      return {
        type: event.action === 'created'
          ? 'session.created'
          : event.action === 'renamed'
            ? 'session.renamed'
            : 'session.updated',
        session: event.session,
      };
    case 'usage':
      return {
        type: 'chat.usage',
        sessionId: event.sessionId,
        usage: event.usage,
        model: event.model,
        variant: event.variant,
      };
    case 'retry':
      return {
        type: 'chat.retry',
        sessionId: event.sessionId,
        status: event.status,
        retryNumber: event.attempt,
        maxRetries: event.maxAttempts,
        errorType: event.errorType,
        message: event.message,
        delayMs: event.delayMs,
        retryAt: event.retryAt,
      };
    case 'failure':
      if (event.category === 'rate_limit') {
        return {
          type: 'error.rate_limit',
          code: event.code,
          message: event.message,
          retryAfterMs: event.retryAfterMs,
          sessionId: event.sessionId,
        };
      }
      if (event.category === 'server') {
        return {
          type: 'error.server',
          code: event.code,
          message: event.message,
          retryAfterMs: event.retryAfterMs,
          sessionId: event.sessionId,
        };
      }
      if (event.category === 'timeout') {
        return {
          type: 'error.timeout',
          code: event.code,
          message: event.message,
          retryAfterMs: event.retryAfterMs,
          sessionId: event.sessionId,
        };
      }
      return { type: 'error', code: event.code, message: event.message, sessionId: event.sessionId };
    case 'queue':
      return event.action === 'added'
        ? { type: 'queue.added', sessionId: event.sessionId, message: event.message }
        : { type: 'queue.sending', sessionId: event.sessionId, queueId: event.queueId };
    case 'ask':
      return event.action === 'requested'
        ? {
          type: 'ask.request',
          sessionId: event.sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          ask: event.ask,
          requestId: event.requestId,
          authority: event.authority,
        }
        : {
          type: 'ask.timeout',
          sessionId: event.sessionId,
          toolCallId: event.toolCallId,
          requestId: event.requestId,
        };
    case 'terminal':
      return null;
  }
}

export interface Jean2EventRouter<Origin> {
  send(origin: Origin, message: ServerMessage): void;
  broadcast(message: ServerMessage): void;
  broadcastToSession(sessionId: string, message: ServerMessage): void;
  sendToController(sessionId: string, message: ServerMessage): void;
  sendToAskTargets(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
  attachOriginToSession(origin: Origin, sessionId: string): void;
}

export function createJean2RuntimeContext<Origin>(router: Jean2EventRouter<Origin>): RuntimeEventContext<Origin> {
  return {
    emit(delivery) {
      if (delivery.event.kind === 'terminal') {
        deliverCapekEvent(delivery);
        return;
      }

      const message = mapCapekEventToServerMessage(delivery.event);
      if (!message) return;

      switch (delivery.audience.scope) {
        case 'origin':
          router.send(delivery.audience.origin, message);
          break;
        case 'session':
          router.broadcastToSession(delivery.audience.sessionId, message);
          break;
        case 'global':
          router.broadcast(message);
          break;
        case 'controller':
          router.sendToController(delivery.audience.sessionId, message);
          break;
        case 'ask_targets':
          router.sendToAskTargets(delivery.audience.sessionId, delivery.audience.authority, message);
          break;
        case 'host':
          deliverCapekEvent(delivery);
          break;
      }
    },
    attachOriginToSession: router.attachOriginToSession,
  };
}

export function deliverCapekEvent(
  delivery: RuntimeDelivery,
  notifications?: Pick<NotificationsApplication, 'notifyTerminalMessage'>,
): void {
  if (delivery.event.kind === 'terminal') {
    (notifications ?? getJean2NotificationsApplication()).notifyTerminalMessage(
      delivery.event.message,
      delivery.event.sessionId,
    );
    return;
  }

  const message = mapCapekEventToServerMessage(delivery.event);
  if (!message) return;

  switch (delivery.audience.scope) {
    case 'global':
      broadcastEvent(message);
      break;
    case 'session':
      broadcastToSessionEvent(delivery.audience.sessionId, message);
      break;
    case 'controller':
      sendToControllerEvent(delivery.audience.sessionId, message);
      break;
    case 'ask_targets':
      sendToAskTargetsEvent(delivery.audience.sessionId, delivery.audience.authority, message);
      break;
    case 'origin':
    case 'host':
      break;
  }
}
