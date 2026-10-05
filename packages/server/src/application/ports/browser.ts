import type { AskAuthority } from '@prokopai/sdk';

export interface BrowserRequestsPort {
  resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null>;
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined;
  acceptsConnection(toolCallId: string, connectionId: string): boolean;
  connectionsChanged(): void;
}
let installed: BrowserRequestsPort | null = null;
export function installBrowserRequestsPort(port: BrowserRequestsPort): void { installed = port; }
export function getBrowserRequestsPort(): BrowserRequestsPort | null { return installed; }
