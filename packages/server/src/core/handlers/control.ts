/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handleClaimMessage,
  handleReleaseMessage,
  handleRequestTakeoverMessage,
  handleRespondTakeoverMessage,
  checkControllerGate,
  sendGateRejection,
} from '@/transport/websocket/handlers/control';
