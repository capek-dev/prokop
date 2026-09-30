import type { AskAuthority } from '@prokopai/sdk';

/**
 * Port for resolving wire-side asks against the live permission runtime.
 *
 * Ask waiters live in the composed agent scope of the harness that owns
 * execution (the Prokop composition today). Transport and adapters must not
 * import that composition directly; they resolve asks through the installed
 * port. When no port is installed, consumers fall back to the process-default
 * Capek runtime through the adapter seam, matching behavior before the
 * composition resolves.
 */
export interface AskResolutionPort {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
}

let current: AskResolutionPort | null = null;

export function installAskResolutionPort(port: AskResolutionPort): void {
  current = port;
}

export function getAskResolutionPort(): AskResolutionPort | null {
  return current;
}
