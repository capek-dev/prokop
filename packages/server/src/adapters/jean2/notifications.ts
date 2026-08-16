import { getPermissionTimeoutMs } from '@/env';
import { getSession } from '@/store/sessions';
import { getScheduledJob } from '@/store/scheduled-jobs';
import { getPermissionRequestByRequestId } from '@/store/pending-asks';
import {
  deletePushSubscription,
  deleteAllOldDeliveries,
  deleteOldDeliveries,
  deleteStaleSubscription,
  getDeliveriesDueForRetry,
  getPushSubscriptionForDispatch,
  listEnabledSubscriptionsForEvent,
  markDeliveryDelivered,
  markDeliveryExhausted,
  markDeliveryFailed,
  markDeliveryRetryable,
  reserveDelivery,
  updatePushSubscriptionPreferences,
  upsertPushSubscription,
} from '@/store/web-push';
import { getVapidCredentials, isWebPushAvailable, sendWebPush } from '@/services/web-push/credentials';
import { canNotifyForSession as scheduledSessionCanNotify } from '@/domains/scheduling/notifications';
import {
  createNotificationsApplication,
  type NotificationsApplication,
} from '@/application/notifications';
import type { NotificationSenderPort, NotificationStorePort } from '@/application/ports/notifications';

/**
 * Jean2 notification adapter (S4/S5). Wires the notification application to
 * the current store and web-push implementations. The scheduled-run
 * eligibility predicate comes from the scheduling domain (shared policy,
 * not duplicated). A module-level singleton keeps the pending-terminal
 * dispatch map shared between the wired application, the compat dispatch
 * module, and the transport ack handler.
 */

let singleton: NotificationsApplication | null = null;

export function getJean2NotificationsApplication(): NotificationsApplication {
  if (singleton) {
    return singleton;
  }

  const store: NotificationStorePort = {
    upsertSubscription: upsertPushSubscription,
    updatePreferences: updatePushSubscriptionPreferences,
    deleteSubscription: deletePushSubscription,
    listEnabledForEvent: listEnabledSubscriptionsForEvent,
    getForDispatch: getPushSubscriptionForDispatch,
    reserveDelivery,
    markDelivered: markDeliveryDelivered,
    markFailed: markDeliveryFailed,
    markRetryable: markDeliveryRetryable,
    markExhausted: markDeliveryExhausted,
    deleteStaleSubscription,
    getDueForRetry: getDeliveriesDueForRetry,
    deleteOldDeliveries,
    deleteAllOldDeliveries,
  };

  const sender: NotificationSenderPort = {
    send: sendWebPush,
    config() {
      const available = isWebPushAvailable();
      const creds = available ? getVapidCredentials() : null;
      return {
        available,
        vapidPublicKey: creds?.publicKey ?? '',
      };
    },
  };

  singleton = createNotificationsApplication({
    store,
    sender,
    getSession,
    canNotifyForSession: (session) => scheduledSessionCanNotify(session, (id) => getScheduledJob(id)),
    getPendingAsk: getPermissionRequestByRequestId,
    permissionTimeoutMs: getPermissionTimeoutMs,
  });

  return singleton;
}
