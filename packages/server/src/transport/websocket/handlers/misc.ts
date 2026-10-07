import type { RouterContext } from '@/transport/websocket/router-context';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { handleClientRegistration, getClientByClientId, getClientIdForConnection, getConnectionById } from '@/transport/websocket/connection-registry';
import { sandboxController } from '@/infrastructure/sandbox/controller';
import type { SandboxRespondMessage } from '@/infrastructure/sandbox/types';
import {
  resolveAsk as capekResolveAsk,
  getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk,
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
} from '@/harnesses/prokop/permission/ask-user-api';
import { getBrowserRequestsPort } from '@/application/ports/browser';
import { getAskResolutionPort } from '@/application/ports/ask-resolution';
import { getControlState } from '@/transport/websocket/control-registry';
import { requireWireApplication } from '@/transport/websocket/application';
import { checkAskResponseEligibility } from '@/application/ports/control';
import { getCodexApprovalPort } from '@/application/ports/codex-approval';
import { getClaudeApprovalPort } from '@/application/ports/claude-approval';
import type {
  ClientRegisterMessage,
  AskResponseMessage,
  AskAuthority,
  NotificationAcknowledgeMessage,
  PongMessage,
} from '@prokopai/sdk';

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

const harnessApproval = (toolCallId: string) => toolCallId.startsWith('codex-approval:')
  ? getCodexApprovalPort() : toolCallId.startsWith('claude-approval:') ? getClaudeApprovalPort() : null;
const isHarnessApproval = (toolCallId: string): boolean =>
  toolCallId.startsWith('codex-approval:') || toolCallId.startsWith('claude-approval:');

// The installed prokop ask-resolution port routes through the composed
// permission runtime. When no port is installed (router-level tests, hosts
// without the wired application) fall back to the process-default Capek
// runtime, matching behavior before the composition resolves.
const askResponseDependencies: AskResponseDependencies = {
  resolveAsk: (toolCallId, response, requestId) => isHarnessApproval(toolCallId)
    ? (harnessApproval(toolCallId)?.resolve(toolCallId, response, requestId) ?? Promise.resolve(false))
    : (getAskResolutionPort()?.resolveAsk(toolCallId, response, requestId)
      ?? capekResolveAsk(toolCallId, response, requestId)),
  getSessionIdForPendingAsk: (toolCallId, requestId) => isHarnessApproval(toolCallId)
    ? Promise.resolve(harnessApproval(toolCallId)?.getSessionId(toolCallId, requestId) ?? null)
    : (getAskResolutionPort()?.getSessionIdForPendingAsk(toolCallId, requestId)
      ?? capekGetSessionIdForPendingAsk(toolCallId, requestId)),
  getAuthorityForPendingAsk: (toolCallId) => isHarnessApproval(toolCallId)
    ? { visibilityScope: 'controller_only', resolutionMode: 'controller_only' }
    : (getAskResolutionPort()?.getAuthorityForPendingAsk(toolCallId)
      ?? capekGetAuthorityForPendingAsk(toolCallId)),
};

export async function handleAskResponseWithDependencies(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: AskResponseMessage,
  dependencies: AskResponseDependencies,
): Promise<void> {
  const { toolCallId, response, requestId } = msg;
  const askSessionId = await dependencies.getSessionIdForPendingAsk(toolCallId, requestId);
  // Native harness requests require a live request identity, never a legacy tool-call fallback.
  if (isHarnessApproval(toolCallId) && (!requestId || !askSessionId)) return;
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
  if (msg.toolCallId.startsWith('browser-request:')) {
    const browser = getBrowserRequestsPort();
    if (!browser || !msg.requestId || !browser.acceptsConnection(msg.toolCallId, ws)
      || !await browser.getSessionIdForPendingAsk(msg.toolCallId, msg.requestId)) return;
    await handleAskResponseWithDependencies(ctx, ws, msg, browser);
    return;
  }
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
