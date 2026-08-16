/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handleClientRegister,
  handlePong,
  handleNotificationAcknowledge,
  handleAskResponse,
  handleSandboxRespond,
} from '@/transport/websocket/handlers/misc';
