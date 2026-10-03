import type { Message } from '@prokopai/sdk';
import { getHarnessNotificationPort } from '@/application/ports/harness-notifications';
import { getSession } from '@/infrastructure/sqlite/session-store';

/** Learning reviews run as top-level sessions but are background work, never a user's chat. */
function isLearningRun(sessionId: string): boolean {
  return !!getSession(sessionId)?.metadata?.learningRunId;
}

/**
 * Push for a finished top-level reply. The notification policy decides which
 * statuses notify (completed and error) and drops child sessions.
 */
export function notifyHarnessTurnFinished(message: Message | null | undefined): void {
  if (message?.role !== 'assistant' || isLearningRun(message.sessionId)) return;
  try {
    getHarnessNotificationPort()?.notifyTerminalMessage(message, message.sessionId);
  } catch (error: unknown) {
    console.warn('[harness] Completion notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

/** Push for a permission ask the controller must answer. */
export function notifyHarnessPermissionRequired(requestId: string, rootSessionId: string): void {
  if (isLearningRun(rootSessionId)) return;
  try {
    getHarnessNotificationPort()?.notifyPermissionRequired(requestId, rootSessionId);
  } catch (error: unknown) {
    console.warn('[harness] Permission notification failed:', error instanceof Error ? error.message : 'unknown error');
  }
}
