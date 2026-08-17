/**
 * C6 pinned compatibility forwarder. The retry policy implementation and the
 * stream loop moved to `retry/` (`policy.ts` owns classification, backoff,
 * circuit state, and the side-effect barrier; `stream-chat.ts` owns the
 * stream loop). Every prior export resolves to the same function or type
 * identity, so the facade, `core/chat-handler.ts`, and `internal/execution.ts`
 * keep working unchanged.
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
