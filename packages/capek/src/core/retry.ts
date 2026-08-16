/**
 * C6 pinned compatibility forwarder. The retry policy implementation and the
 * stream loop moved to `retry/` (`policy.ts` owns classification, backoff,
 * circuit state, and the side-effect barrier; `stream-chat.ts` owns the
 * stream loop). Every prior export resolves to the same function or type
 * identity, so `compat/jean2.ts`, the facade, and `core/chat-handler.ts`
 * keep working unchanged until C8 retires the compat surface.
 */

export { streamChatWithRetry } from '../retry/stream-chat';
export type { StreamChatEvent, StreamChatFn } from '../retry/stream-chat';
export {
  createRetryCircuitState,
  withRetryCircuitState,
} from '../retry/policy';
export type {
  CircuitState,
  RetryPolicy,
  StreamRetryPolicy,
} from '../retry/policy';
