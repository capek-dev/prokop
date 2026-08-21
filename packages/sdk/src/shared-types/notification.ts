/**
 * Event types that can produce a system notification.
 */
export type NotificationEventType = 'session_completed' | 'session_failed' | 'permission_required';

export type TerminalNotificationStatus = 'completed' | 'error';

export function getTerminalNotificationEventId(
  messageId: string,
  status: TerminalNotificationStatus,
): string {
  return `message:${messageId}:${status}`;
}

/**
 * Per-subscription preferences for which events produce notifications.
 */
export interface NotificationPreferences {
  completion: boolean;
  permission: boolean;
}

/**
 * Serializable push subscription shape, independent of DOM types.
 *
 * This mirrors the portable fields of a browser `PushSubscription` so that
 * the SDK never imports DOM-only types.
 */
export interface WebPushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Public notification configuration returned by the server.
 * Contains only public data (VAPID public key, timeouts).
 */
export interface NotificationConfig {
  available: boolean;
  vapidPublicKey: string;
  permissionTimeoutMs: number;
}

/**
 * Opaque subscription record returned to the client after registration.
 *
 * Endpoint and encryption keys are capability data and are never exposed
 * through this type.
 */
export interface PushSubscriptionRecord {
  id: string;
  clientId: string;
  clientServerId: string;
  clientOrigin: string;
  expirationTime: number | null;
  preferences: NotificationPreferences;
  createdAt: number;
  updatedAt: number;
}

/**
 * Versioned push payload sent by the server to the browser push service.
 *
 * The service worker parses this and derives user-visible copy from `type`.
 * It must never trust arbitrary server-provided titles or HTML.
 */
export interface ProkopaiPushPayloadV1 {
  version: 1;
  eventId: string;
  type: NotificationEventType;
  serverId: string;
  sessionId: string;
  createdAt: number;
  route: string;
}
