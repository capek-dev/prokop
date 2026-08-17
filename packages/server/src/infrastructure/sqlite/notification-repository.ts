import type { NotificationStorePort } from '@/application/ports/notifications';
import {
  deleteAllOldDeliveries,
  deleteOldDeliveries,
  deletePushSubscription,
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
} from './web-push';

export function createNotificationRepository(): NotificationStorePort {
  return {
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
}
