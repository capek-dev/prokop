import { ASK_TIMEOUT } from '@capekai/core/ask-authority';
import { getAuthorityForPendingAsk } from './contracts';
import type { AskAuthorityPort } from '@/application/ports/session';

/**
 * Ask authority adapter (S3). The authority policy implementation stays in
 * Capek until S4; this adapter only exposes the existing timeout and lookup
 * through the application port. The lookup routes through the contracts seam
 * so reconnect pending-sync reads the composed scope's runtime (the same
 * instance whose waiters the WS ask.response handler resolves) instead of the
 * process-default one.
 */
export function createJean2AskAuthorityPort(): AskAuthorityPort {
  return {
    timeoutMs: ASK_TIMEOUT,
    getAuthorityForPendingAsk(toolCallId: string) {
      return getAuthorityForPendingAsk(toolCallId);
    },
  };
}
