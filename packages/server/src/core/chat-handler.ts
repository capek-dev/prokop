/**
 * Temporary forwarding module (S2).
 *
 * The wire-level chat handler now lives in `transport/websocket/chat-handler`.
 * The old `Jean2RouterContext` alias stays generic over an opaque origin so
 * existing consumers that pass socket-like origins keep typechecking.
 */
import type { RouterContext, ClientEntry } from '@/transport/websocket/router-context';

export { handleChat, handleSessionEditMessage, regenerateSessionTitle } from '@/transport/websocket/chat-handler';

export type Jean2RouterContext = RouterContext<unknown>;

export type Jean2RouterClientEntry = ClientEntry;
