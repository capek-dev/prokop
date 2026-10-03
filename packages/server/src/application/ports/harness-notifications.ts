import type { AssistantMessage } from '@prokopai/sdk';

/**
 * Web-push hooks for native harnesses (Claude CLI, Codex CLI). The Prokop
 * runtime reaches the notification application through Capek host events;
 * native harnesses call this port at the same two moments: a top-level reply
 * reached a terminal status, and a permission ask is waiting.
 */
export interface HarnessNotificationPort {
  notifyTerminalMessage(message: AssistantMessage, sessionId: string): void;
  notifyPermissionRequired(requestId: string, rootSessionId: string): void;
}

let current: HarnessNotificationPort | null = null;

export function installHarnessNotificationPort(port: HarnessNotificationPort): void {
  current = port;
}

export function getHarnessNotificationPort(): HarnessNotificationPort | null {
  return current;
}
