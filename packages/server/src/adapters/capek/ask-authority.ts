import { ASK_TIMEOUT, getAuthorityForPendingAsk } from '@capekai/core/ask-authority';
import type { AskAuthorityPort } from '@/application/ports/session';

/**
 * Ask authority adapter (S3). The authority policy implementation stays in
 * Capek until S4; this adapter only exposes the existing timeout and lookup
 * through the application port.
 */
export function createJean2AskAuthorityPort(): AskAuthorityPort {
  return {
    timeoutMs: ASK_TIMEOUT,
    getAuthorityForPendingAsk(toolCallId: string) {
      return getAuthorityForPendingAsk(toolCallId);
    },
  };
}
