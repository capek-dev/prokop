import type {
  AssistantMessage,
  NotificationEventType,
} from '@jean2/sdk';
import { getJean2NotificationsApplication } from '@/adapters/jean2/notifications';

/**
 * S4 compatibility module for the web-push dispatch surface. The
 * reservation and delivery policy moved to the notification domain and
 * application; this module keeps the pre-S4 export identities
 * (`dispatchNotification`, `acknowledgePendingNotification`,
 * `notifyTerminalMessage`, `dispatchPendingPermissionNotification`,
 * `notifyPermissionRequired`) over the shared singleton application built by
 * the Jean2 adapter, so the event adapter, the interaction bindings, and the
 * transport ack handler keep identical behavior.
 */

export function dispatchNotification(input: {
  eventId: string;
  eventType: NotificationEventType;
  sessionId: string;
}): Promise<void> {
  return getJean2NotificationsApplication().dispatch(input);
}

export function acknowledgePendingNotification(
  eventId: string,
  sessionId: string,
  clientId: string,
): boolean {
  return getJean2NotificationsApplication().acknowledgePendingNotification(eventId, sessionId, clientId);
}

export function notifyTerminalMessage(message: AssistantMessage, sessionId: string): void {
  getJean2NotificationsApplication().notifyTerminalMessage(message, sessionId);
}

export function dispatchPendingPermissionNotification(
  requestId: string,
  rootSessionId: string,
): Promise<void> {
  return getJean2NotificationsApplication().dispatchPendingPermissionNotification(requestId, rootSessionId);
}

export function notifyPermissionRequired(requestId: string, rootSessionId: string): void {
  getJean2NotificationsApplication().notifyPermissionRequired(requestId, rootSessionId);
}
