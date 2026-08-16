/**
 * Temporary forwarding module (S2).
 *
 * The router context now lives in `transport/websocket/router-context`.
 */
export type { ClientEntry, RouterContext } from '@/transport/websocket/router-context';
export { sendGateRejection } from '@/transport/websocket/router-context';
