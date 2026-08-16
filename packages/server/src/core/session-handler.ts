/**
 * Temporary forwarding module (S2).
 *
 * The wire-level session handlers now live in `transport/websocket/session-handler`.
 */
export { handleSessionCompact, handleSessionRevert, handleSessionFork } from '@/transport/websocket/session-handler';
