/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handleQueueAdd,
  handleQueueRemove,
} from '@/transport/websocket/handlers/queue';
