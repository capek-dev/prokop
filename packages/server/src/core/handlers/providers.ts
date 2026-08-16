/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handleProviderConnect,
  handleProviderDisconnect,
} from '@/transport/websocket/handlers/providers';
