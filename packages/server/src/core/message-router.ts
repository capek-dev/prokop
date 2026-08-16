/**
 * Temporary forwarding module (S2).
 *
 * The message router now lives in `transport/websocket/message-router`.
 */
export { handleClientMessage } from '@/transport/websocket/message-router';
export type { RouterContext, ClientEntry } from '@/transport/websocket/router-context';
