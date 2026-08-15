import type { ServerWebSocket } from 'bun';
import type { RouterContext } from '../router-context';
import { handleClientRegistration, getClientIdForWs } from '../client-registry';
import { resolveAsk, getSessionIdForPendingAsk, getAuthorityForPendingAsk, sandboxController, type SandboxRespondMessage } from '@capekai/core/compat/jean2';
import { getControlState } from '../session-control-registry';
import { checkAskResponseEligibility } from '../capability-router';
import type {
  ClientRegisterMessage,
  AskResponseMessage,
  AskAuthority,
  NotificationAcknowledgeMessage,
  PongMessage,
} from '@jean2/sdk';
import { acknowledgePendingNotification } from '@/services/web-push/dispatch';

export function handleClientRegister(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: ClientRegisterMessage,
): void {
  handleClientRegistration(ws, msg, ctx.send);
}

export function handlePong(
  ctx: RouterContext,
  ws: ServerWebSocket,
  _msg: PongMessage,
): void {
  const clientData = ctx.clients.get(ws);
  if (clientData) {
    clientData.missedPings = 0;
  }
}

export function handleNotificationAcknowledge(
  _ctx: RouterContext,
  ws: ServerWebSocket,
  msg: NotificationAcknowledgeMessage,
): void {
  const clientId = getClientIdForWs(ws);
  if (!clientId) {
    return;
  }

  acknowledgePendingNotification(msg.eventId, msg.sessionId, clientId);
}

export function handleAskResponse(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: AskResponseMessage,
): void {
  const { toolCallId, response, requestId } = msg;
  const askSessionId = getSessionIdForPendingAsk(toolCallId, requestId);
  if (askSessionId) {
    const controlState = getControlState(askSessionId);
    const senderClientId = getClientIdForWs(ws);

    const askAuthority: AskAuthority =
      getAuthorityForPendingAsk(toolCallId) ?? {
        visibilityScope: 'controller_only',
        resolutionMode: 'controller_only',
      };

    if (!senderClientId && controlState.status !== 'uncontrolled') {
      ctx.send(ws, {
        type: 'ask.response_rejected',
        sessionId: askSessionId,
        toolCallId,
        requestId,
        code: 'not_allowed',
        message: 'Client must be registered to respond to asks',
      });
      return;
    }

    const eligibility = checkAskResponseEligibility(
      senderClientId ?? '',
      askSessionId,
      controlState.controllerClientId,
      askAuthority,
    );

    if (!eligibility.eligible) {
      ctx.send(ws, {
        type: 'ask.response_rejected',
        sessionId: askSessionId,
        toolCallId,
        requestId,
        code: senderClientId !== controlState.controllerClientId ? 'not_controller' : 'not_allowed',
        message: eligibility.reason ?? 'You are not eligible to respond to this ask',
      });
      return;
    }
  }
  resolveAsk(toolCallId, response, requestId);
}

export function handleSandboxRespond(
  ctx: RouterContext,
  ws: ServerWebSocket,
  msg: SandboxRespondMessage,
): void {
  try {
    sandboxController.respond(msg.callId, msg.response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sandbox response failed';
    ctx.send(ws, { type: 'error', code: 'sandbox_error', message });
  }
}
