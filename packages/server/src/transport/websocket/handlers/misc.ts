import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { handleClientRegistration, getClientByClientId, getClientIdForConnection, getConnectionById } from '../connection-registry';
import { resolveAsk, getSessionIdForPendingAsk, getAuthorityForPendingAsk, sandboxController, type SandboxRespondMessage } from '@/adapters/capek/contracts';
import { getControlState } from '../control-registry';
import { requireWireApplication } from '../application';
import { checkAskResponseEligibility } from '@/application/ports/control';
import type {
  ClientRegisterMessage,
  AskResponseMessage,
  AskAuthority,
  NotificationAcknowledgeMessage,
  PongMessage,
} from '@jean2/sdk';

export function handleClientRegister(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: ClientRegisterMessage,
): void {
  handleClientRegistration(ws, msg, ctx.send);
}

export function handlePong(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  _msg: PongMessage,
): void {
  const clientData = ctx.clients.get(ws);
  if (clientData) {
    clientData.missedPings = 0;
  }
}

export function handleNotificationAcknowledge(
  _ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: NotificationAcknowledgeMessage,
): void {
  const conn = getConnectionById(ws);
  const clientId = conn?.clientId ?? null;
  if (!clientId) {
    return;
  }

  requireWireApplication().notifications.acknowledgePendingNotification(msg.eventId, msg.sessionId, clientId);
}

export interface AskResponseDependencies {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
}

const askResponseDependencies: AskResponseDependencies = {
  resolveAsk,
  getSessionIdForPendingAsk,
  getAuthorityForPendingAsk,
};

export async function handleAskResponseWithDependencies(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: AskResponseMessage,
  dependencies: AskResponseDependencies,
): Promise<void> {
  const { toolCallId, response, requestId } = msg;
  const askSessionId = await dependencies.getSessionIdForPendingAsk(toolCallId, requestId);
  if (askSessionId) {
    const controlState = getControlState(askSessionId);
    const senderClientId = getClientIdForConnection(ws);

    const askAuthority: AskAuthority =
      dependencies.getAuthorityForPendingAsk(toolCallId) ?? {
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

    const eligibility = checkAskResponseEligibility({
      clientId: senderClientId ?? '',
      capabilities: senderClientId
        ? (getClientByClientId(senderClientId)?.capabilities ?? [])
        : [],
      controllerClientId: controlState.controllerClientId ?? null,
      authority: askAuthority,
    });

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
  await dependencies.resolveAsk(toolCallId, response, requestId);
}

export async function handleAskResponse(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: AskResponseMessage,
): Promise<void> {
  await handleAskResponseWithDependencies(ctx, ws, msg, askResponseDependencies);
}

export function handleSandboxRespond(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SandboxRespondMessage,
): void {
  try {
    sandboxController.respond(msg.callId, msg.response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sandbox response failed';
    ctx.send(ws, { type: 'error', code: 'sandbox_error', message });
  }
}
