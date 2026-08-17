import { randomUUID } from 'crypto';
import { getDatabase } from './database';
import type {
  PushSubscriptionRecord,
  NotificationPreferences,
  WebPushSubscriptionInput,
} from '@jean2/sdk';

export interface PushSubscriptionRow {
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

export interface PushDeliveryRow {
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

function mapRowToSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    clientServerId: row.client_server_id,
    clientOrigin: row.client_origin,
    expirationTime: row.expiration_time,
    preferences: {
      completion: row.notify_completion === 1,
      permission: row.notify_permission === 1,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpsertSubscriptionInput {
  clientId: string;
  clientServerId: string;
  clientOrigin: string;
  subscription: WebPushSubscriptionInput;
  preferences: NotificationPreferences;
}

/**
 * Upsert a push subscription by endpoint uniqueness.
 * If the endpoint already exists, update keys, preferences, and metadata.
 * Returns the subscription record without endpoint or encryption keys.
 */
export function upsertPushSubscription(
  input: UpsertSubscriptionInput,
): PushSubscriptionRecord {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.query(
    'SELECT * FROM push_subscriptions WHERE endpoint = ?',
  ).get(input.subscription.endpoint) as PushSubscriptionRow | undefined;

  if (existing) {
    db.run(
      `UPDATE push_subscriptions
       SET client_id = ?, client_server_id = ?, client_origin = ?,
           p256dh = ?, auth = ?, expiration_time = ?,
           notify_completion = ?, notify_permission = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        input.clientId,
        input.clientServerId,
        input.clientOrigin,
        input.subscription.keys.p256dh,
        input.subscription.keys.auth,
        input.subscription.expirationTime,
        input.preferences.completion ? 1 : 0,
        input.preferences.permission ? 1 : 0,
        now,
        existing.id,
      ],
    );

    const updated = db.query(
      'SELECT * FROM push_subscriptions WHERE id = ?',
    ).get(existing.id) as PushSubscriptionRow;
    return mapRowToSubscription(updated);
  }

  const id = randomUUID();
  db.run(
    `INSERT INTO push_subscriptions
      (id, client_id, client_server_id, client_origin, endpoint, p256dh, auth,
       expiration_time, notify_completion, notify_permission,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.clientId,
      input.clientServerId,
      input.clientOrigin,
      input.subscription.endpoint,
      input.subscription.keys.p256dh,
      input.subscription.keys.auth,
      input.subscription.expirationTime,
      input.preferences.completion ? 1 : 0,
      input.preferences.permission ? 1 : 0,
      now,
      now,
    ],
  );

  const row = db.query(
    'SELECT * FROM push_subscriptions WHERE id = ?',
  ).get(id) as PushSubscriptionRow;
  return mapRowToSubscription(row);
}

/**
 * Get a subscription by ID (without exposing endpoint or keys).
 */
export function getPushSubscription(id: string): PushSubscriptionRecord | null {
  const db = getDatabase();
  const row = db.query(
    'SELECT * FROM push_subscriptions WHERE id = ?',
  ).get(id) as PushSubscriptionRow | undefined;
  return row ? mapRowToSubscription(row) : null;
}

/**
 * Update notification preferences for a subscription.
 */
export function updatePushSubscriptionPreferences(
  id: string,
  preferences: NotificationPreferences,
): PushSubscriptionRecord | null {
  const db = getDatabase();
  const now = Date.now();
  const result = db.run(
    `UPDATE push_subscriptions
     SET notify_completion = ?, notify_permission = ?, updated_at = ?
     WHERE id = ?`,
    [
      preferences.completion ? 1 : 0,
      preferences.permission ? 1 : 0,
      now,
      id,
    ],
  );

  if (result.changes === 0) {
    return null;
  }

  const row = db.query(
    'SELECT * FROM push_subscriptions WHERE id = ?',
  ).get(id) as PushSubscriptionRow;
  return mapRowToSubscription(row);
}

/**
 * Delete a push subscription by ID. Idempotent: returns false if not found.
 */
export function deletePushSubscription(id: string): boolean {
  const db = getDatabase();
  const result = db.run(
    'DELETE FROM push_subscriptions WHERE id = ?',
    [id],
  );
  return result.changes > 0;
}

/**
 * Get the full subscription row including endpoint and keys.
 * Used internally by the dispatch service for sending pushes.
 */
export function getPushSubscriptionForDispatch(
  id: string,
): (PushSubscriptionRow & { endpoint: string; p256dh: string; auth: string }) | null {
  const db = getDatabase();
  const row = db.query(
    'SELECT * FROM push_subscriptions WHERE id = ?',
  ).get(id) as PushSubscriptionRow | undefined;
  return row ?? null;
}

/**
 * List all subscriptions that have the given event type enabled.
 * Used by the dispatch service to determine recipients.
 */
export function listEnabledSubscriptionsForEvent(
  eventType: 'session_completed' | 'session_failed' | 'permission_required',
): PushSubscriptionRow[] {
  const db = getDatabase();
  const column = eventType === 'permission_required'
    ? 'notify_permission'
    : 'notify_completion';

  return db.query(
    `SELECT * FROM push_subscriptions WHERE ${column} = 1`,
  ).all() as PushSubscriptionRow[];
}

// ── Delivery tracking ─────────────────────────────────────────

export type DeliveryStatus = 'delivered' | 'failed' | 'pending_retry' | 'permanent_failure';

export interface ReserveDeliveryInput {
  eventId: string;
  subscriptionId: string;
  eventType: string;
}

/**
 * Atomically reserve a delivery row. Returns true if this is a new event
 * (should send), false if it already exists (duplicate, skip).
 */
export function reserveDelivery(input: ReserveDeliveryInput): boolean {
  const db = getDatabase();
  const now = Date.now();

  const existing = db.query(
    'SELECT status FROM push_deliveries WHERE event_id = ? AND subscription_id = ?',
  ).get(input.eventId, input.subscriptionId) as { status: string } | undefined;

  if (existing) {
    return false;
  }

  db.run(
    `INSERT INTO push_deliveries
      (event_id, subscription_id, event_type, status, attempt_count, created_at)
     VALUES (?, ?, ?, 'pending_retry', 0, ?)`,
    [input.eventId, input.subscriptionId, input.eventType, now],
  );
  return true;
}

/**
 * Mark a delivery as delivered.
 */
export function markDeliveryDelivered(eventId: string, subscriptionId: string): void {
  const db = getDatabase();
  const now = Date.now();
  db.run(
    `UPDATE push_deliveries
     SET status = 'delivered', delivered_at = ?, attempted_at = ?, next_attempt_at = NULL, error = NULL
     WHERE event_id = ? AND subscription_id = ?`,
    [now, now, eventId, subscriptionId],
  );

  db.run(
    'UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?',
    [now, subscriptionId],
  );
}

/**
 * Mark a delivery as permanently failed (4xx response).
 * Also records the failure on the subscription.
 */
export function markDeliveryFailed(
  eventId: string,
  subscriptionId: string,
  error: string,
): void {
  const db = getDatabase();
  const now = Date.now();
  db.run(
    `UPDATE push_deliveries
     SET status = 'permanent_failure', attempted_at = ?, next_attempt_at = NULL, error = ?, attempt_count = attempt_count + 1
     WHERE event_id = ? AND subscription_id = ?`,
    [now, error, eventId, subscriptionId],
  );

  db.run(
    'UPDATE push_subscriptions SET last_failure_at = ?, last_failure_reason = ? WHERE id = ?',
    [now, error, subscriptionId],
  );
}

/**
 * Mark a delivery for retry (transient failure like 429, 5xx, or network error).
 */
export function markDeliveryRetryable(
  eventId: string,
  subscriptionId: string,
  error: string,
  nextAttemptAt: number,
): void {
  const db = getDatabase();
  const now = Date.now();
  db.run(
    `UPDATE push_deliveries
     SET status = 'pending_retry', attempted_at = ?, next_attempt_at = ?, error = ?, attempt_count = attempt_count + 1
     WHERE event_id = ? AND subscription_id = ?`,
    [now, nextAttemptAt, error, eventId, subscriptionId],
  );

  db.run(
    'UPDATE push_subscriptions SET last_failure_at = ?, last_failure_reason = ? WHERE id = ?',
    [now, error, subscriptionId],
  );
}

/**
 * Delete a subscription when the push service returns 404 or 410.
 */
export function deleteStaleSubscription(id: string): void {
  const db = getDatabase();
  db.run('DELETE FROM push_subscriptions WHERE id = ?', [id]);
}

/**
 * Delete delivery records older than the given timestamp.
 * Used for periodic cleanup.
 */
export function deleteOldDeliveries(olderThan: number): number {
  const db = getDatabase();
  const result = db.run(
    'DELETE FROM push_deliveries WHERE created_at < ? AND status = ?',
    [olderThan, 'delivered'],
  );
  return result.changes;
}

const MAX_RETRY_ATTEMPTS = 5;

/**
 * List deliveries that are due for retry: status is 'pending_retry',
 * next_attempt_at has passed, and attempt_count is under the max.
 */
export function getDeliveriesDueForRetry(now: number): PushDeliveryRow[] {
  const db = getDatabase();
  return db.query(
    `SELECT * FROM push_deliveries
     WHERE status = 'pending_retry'
       AND next_attempt_at <= ?
       AND attempt_count < ?`,
  ).all(now, MAX_RETRY_ATTEMPTS) as PushDeliveryRow[];
}

/**
 * Mark a delivery as permanently failed after exhausting retries.
 */
export function markDeliveryExhausted(eventId: string, subscriptionId: string): void {
  const db = getDatabase();
  db.run(
    `UPDATE push_deliveries
     SET status = 'permanent_failure', next_attempt_at = NULL
     WHERE event_id = ? AND subscription_id = ?`,
    [eventId, subscriptionId],
  );
}

/**
 * Delete all delivery records (not just 'delivered') older than the given timestamp.
 * More aggressive cleanup for periodic maintenance.
 */
export function deleteAllOldDeliveries(olderThan: number): number {
  const db = getDatabase();
  const result = db.run(
    'DELETE FROM push_deliveries WHERE created_at < ?',
    [olderThan],
  );
  return result.changes;
}
