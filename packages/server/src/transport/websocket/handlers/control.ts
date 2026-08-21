import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { createWirePorts, requireWireApplication } from '../application';
import type {
  SessionControlClaimMessage,
  SessionControlReleaseMessage,
  SessionControlRequestTakeoverMessage,
  SessionControlRespondTakeoverMessage,
} from '@prokopai/sdk';

/**
 * Controller wire handlers (S3). The claim, release, and takeover state
 * machine stays in the transport control registry behind the control port;
 * these handlers only derive the wire ports and delegate the outcome
 * delivery order to the control application use cases.
 */
export function handleClaimMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlClaimMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.claim(wire.delivery, ws, msg.sessionId);
}

export function handleReleaseMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlReleaseMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.release(wire.delivery, ws, msg.sessionId);
}

export function handleRequestTakeoverMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlRequestTakeoverMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.requestTakeover(wire.delivery, ws, msg.sessionId);
}

export function handleRespondTakeoverMessage(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionControlRespondTakeoverMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().control.respondTakeover(
    wire.delivery,
    ws,
    msg.sessionId,
    msg.requesterClientId,
    msg.decision,
  );
}

// Compatibility re-exports: the pre-S3 handler module exposed the gate
// check and rejection delivery. The gate policy lives in the controller
// domain (`@/domains/controllers`), applied by the control registry; the
// application uses the same functions through the gate port.
export { checkControllerGate } from '../control-registry';
export { sendGateRejection } from '../router-context';
