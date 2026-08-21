import type {
  NotificationPreferences,
  PushSubscriptionRecord,
  Session,
  WebPushSubscriptionInput,
} from '@prokopai/sdk';

/**
 * Inward-facing notification ports (S4/S5). The reservation and delivery
 * policy lives in the notification domain (`@/domains/notifications`); these
 * ports carry the subscription and delivery store seam, the push sender
 * seam, and the session/pending-ask/timeout lookups as structural contracts,
 * so the application never imports the store. The Jean2 adapter wraps the
 * current store and web-push implementations.
 */

/** Structural copy of the store subscription row. */
export interface NotificationSubscriptionRow {
  id: string;
  client_id: string;
  client_server_id: string;
  client_origin: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  notify_completion: number;
  notify_permission: number;
  created_at: number;
  updated_at: number;
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_reason: string | null;
}

/** Structural copy of the store delivery row. */
export interface NotificationDeliveryRow {
  event_id: string;
  subscription_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  created_at: number;
  attempted_at: number | null;
  next_attempt_at: number | null;
  delivered_at: number | null;
  error: string | null;
}

export interface ReserveNotificationDeliveryInput {
  eventId: string;
  subscriptionId: string;
  eventType: string;
}

export interface UpsertNotificationSubscriptionInput {
  clientId: string;
  clientServerId: string;
  clientOrigin: string;
  subscription: WebPushSubscriptionInput;
  preferences: NotificationPreferences;
}

export interface NotificationSenderResult {
  success: boolean;
  statusCode: number;
  body?: string;
}

export interface NotificationSenderPort {
  send(input: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    payload: string;
    ttl?: number;
  }): Promise<NotificationSenderResult>;
  config(): { available: boolean; vapidPublicKey: string };
}

export interface NotificationStorePort {
  upsertSubscription(input: UpsertNotificationSubscriptionInput): PushSubscriptionRecord;
  updatePreferences(id: string, preferences: NotificationPreferences): PushSubscriptionRecord | null;
  deleteSubscription(id: string): boolean;
  listEnabledForEvent(
    eventType: 'session_completed' | 'session_failed' | 'permission_required',
  ): NotificationSubscriptionRow[];
  getForDispatch(
    id: string,
  ): (NotificationSubscriptionRow & { endpoint: string; p256dh: string; auth: string }) | null;
  reserveDelivery(input: ReserveNotificationDeliveryInput): boolean;
  markDelivered(eventId: string, subscriptionId: string): void;
  markFailed(eventId: string, subscriptionId: string, error: string): void;
  markRetryable(eventId: string, subscriptionId: string, error: string, nextAttemptAt: number): void;
  markExhausted(eventId: string, subscriptionId: string): void;
  deleteStaleSubscription(id: string): void;
  getDueForRetry(now: number): NotificationDeliveryRow[];
  deleteOldDeliveries(olderThan: number): number;
  deleteAllOldDeliveries(olderThan: number): number;
}

export interface PendingAskLookup {
  status: string;
}

export interface NotificationsApplicationDeps {
  store: NotificationStorePort;
  sender: NotificationSenderPort;
  getSession(id: string): Session | null;
  /** Scheduled-run notification eligibility. The adapter wires this to the
   * scheduling domain predicate so the policy is shared, not duplicated. */
  canNotifyForSession(session: Session): boolean;
  getPendingAsk(requestId: string): PendingAskLookup | null | undefined;
  permissionTimeoutMs(): number;
}
