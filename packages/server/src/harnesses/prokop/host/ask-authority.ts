import {
  ASK_TIMEOUT,
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
} from '@/harnesses/prokop/permission/ask-user-api';
import { getAskResolutionPort } from '@/application/ports/ask-resolution';
import type { AskAuthorityPort } from '@/application/ports/session';

/**
 * Ask authority adapter (S3). The authority policy implementation stays in
 * the harness-owned permission runtime; this adapter only exposes the
 * existing timeout and lookup through the application port. The lookup reads
 * the installed ask-resolution port so reconnect pending-sync sees the same
 * composed runtime whose waiters the WS ask.response handler resolves. When
 * no port is installed it falls back to the process-default Capek runtime,
 * matching behavior before the composition resolves.
 */
export function createProkopAskAuthorityPort(): AskAuthorityPort {
  return {
    timeoutMs: ASK_TIMEOUT,
    getAuthorityForPendingAsk(toolCallId: string) {
      return getAskResolutionPort()?.getAuthorityForPendingAsk(toolCallId)
        ?? capekGetAuthorityForPendingAsk(toolCallId);
    },
  };
}
