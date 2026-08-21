import type { ProkopaiClient } from '@prokopai/sdk';
import { storage, STORAGE_KEYS } from '@/lib/storage';
import { useNotificationStore } from '@/stores/notificationStore';
import {
  detectNotificationSupport,
  getNotificationPermission,
  serializePushSubscription,
  urlBase64ToApplicationServerKey,
} from './notificationSupport';

async function getClientId(): Promise<string> {
  const existing = await storage.get<string>(STORAGE_KEYS.CLIENT_ID);
  return existing ?? crypto.randomUUID();
}

const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;
const REGISTRATION_RECONCILE_GRACE_MS = 5_000;

async function getReadyServiceWorker(): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('The notification service worker is not active. Reload Jean2 and try again.'));
    }, SERVICE_WORKER_READY_TIMEOUT_MS);

    void navigator.serviceWorker.ready.then(
      (registration) => {
        window.clearTimeout(timeoutId);
        resolve(registration);
      },
      (err: unknown) => {
        window.clearTimeout(timeoutId);
        reject(err);
      },
    );
  });
}

function clearBadge(): void {
  try {
    const nav = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
    };
    void nav.clearAppBadge?.();
  } catch {
    // Non-critical
  }
}

/**
 * Enable system notifications for the active server.
 *
 * Performs feature/secure-context checks, requests permission from a direct
 * user action, subscribes with the server's VAPID key, and registers with
 * the server through the SDK REST client.
 */
export async function enableNotifications(
  client: ProkopaiClient,
  serverId: string,
  serverName: string,
  serverUrl: string,
): Promise<void> {
  const store = useNotificationStore.getState();
  const support = store.support;

  if (support !== 'supported') {
    store.setError('Notifications are not supported in this environment.');
    return;
  }

  store.setRegistrationState('enabling');
  store.setError(null);

  try {
    // 1. Request permission (from user gesture)
    const permission = await Notification.requestPermission();
    store.setPermission(permission);
    if (permission !== 'granted') {
      store.setRegistrationState('denied');
      return;
    }

    // 2. Wait for service worker to be ready
    const reg = await getReadyServiceWorker();

    // 3. Fetch VAPID public key from server
    const config = await client.http.notifications.getConfig();
    if (!config.available) {
      throw new Error('Server does not support web push notifications.');
    }

    // 4. Remove the previous registration for this server before replacing
    // the browser subscription. This prevents stale endpoints from receiving
    // duplicate delivery attempts after re-enabling notifications.
    if (store.registration?.serverId === serverId) {
      try {
        await client.http.notifications.deleteSubscription(store.registration.subscriptionId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[Notifications] Failed to remove previous server registration: ${message}`);
      }
    }

    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) {
      await existingSub.unsubscribe();
    }

    // 5. Subscribe with VAPID key
    const applicationServerKey = urlBase64ToApplicationServerKey(config.vapidPublicKey);
    const newSub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // 6. Register with server via SDK
    const clientId = await getClientId();
    const subscription = serializePushSubscription(newSub);
    const result = await client.http.notifications.upsertSubscription({
      clientId,
      clientServerId: serverId,
      clientOrigin: window.location.origin,
      subscription,
      preferences: {
        completion: store.notifyCompletion,
        permission: store.notifyPermission,
      },
    });

    // 7. Persist registration metadata
    store.setRegistration({
      serverId,
      serverName,
      serverUrl,
      subscriptionId: result.subscription.id,
      enabledAt: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Notifications] Failed to enable system notifications: ${message}`);
    store.setError(message);
    store.setRegistrationState('error');
  }
}

/**
 * Disable system notifications.
 *
 * Deletes the server registration, unsubscribes the browser subscription,
 * clears local metadata, and clears the app badge.
 */
export async function disableNotifications(client: ProkopaiClient | null): Promise<void> {
  const store = useNotificationStore.getState();
  const { registration } = store;

  // 1. Delete server registration when reachable
  if (client && registration) {
    try {
      await client.http.notifications.deleteSubscription(registration.subscriptionId);
    } catch {
      // Server unreachable: still unsubscribe locally. Server prunes on 404/410.
    }
  }

  // 2. Unsubscribe browser PushSubscription
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // Non-critical
  }

  // 3. Clear local metadata
  store.reset();

  // 4. Clear badge
  clearBadge();
}

/**
 * Update notification preferences on the server for an active subscription.
 */
export async function updatePreferences(
  client: ProkopaiClient,
  preferences: { completion: boolean; permission: boolean },
): Promise<void> {
  const store = useNotificationStore.getState();
  const { registration } = store;

  if (!registration) {
    // No server registration: just update local state
    store.setNotifyCompletion(preferences.completion);
    store.setNotifyPermission(preferences.permission);
    return;
  }

  try {
    await client.http.notifications.updatePreferences(
      registration.subscriptionId,
      { preferences },
    );
  } catch {
    // Server unreachable: still update local state
  }

  store.setNotifyCompletion(preferences.completion);
  store.setNotifyPermission(preferences.permission);
}

/**
 * Reconcile the browser subscription with server state on foreground.
 *
 * Checks if the browser still has a valid PushSubscription and re-registers
 * it with the designated server if needed. Does NOT request permission.
 */
export async function reconcileSubscription(client: ProkopaiClient | null): Promise<void> {
  const store = useNotificationStore.getState();
  const { support, registration } = store;

  if (support !== 'supported' || !registration) {
    return;
  }

  // Enabling already registered this subscription with the server. Avoid an
  // immediate duplicate PUT when the new registration updates the store.
  if (Date.now() - registration.enabledAt < REGISTRATION_RECONCILE_GRACE_MS) {
    return;
  }

  // Check if browser subscription still exists
  let browserSub: PushSubscription | null;
  try {
    const reg = await navigator.serviceWorker.ready;
    browserSub = await reg.pushManager.getSubscription();
  } catch {
    return;
  }

  if (!browserSub) {
    // Browser subscription disappeared: show recoverable error
    store.setError('Browser subscription was lost. Re-enable notifications to fix.');
    store.setRegistrationState('error');
    return;
  }

  // Re-register with server if reachable
  if (client) {
    try {
      const clientId = await getClientId();
      const subscription = serializePushSubscription(browserSub);
      await client.http.notifications.upsertSubscription({
        clientId,
        clientServerId: registration.serverId,
        clientOrigin: window.location.origin,
        subscription,
        preferences: {
          completion: store.notifyCompletion,
          permission: store.notifyPermission,
        },
      });
      store.setError(null);
      store.setRegistrationState('enabled');
    } catch {
      // Server unreachable: non-critical, will retry on next foreground
    }
  }
}

/**
 * Initialize notification support detection and hydrate persisted state.
 * Call on app startup.
 */
export function initNotificationSupport(): void {
  const support = detectNotificationSupport();
  const permission = getNotificationPermission();
  useNotificationStore.getState().setSupport(support);
  useNotificationStore.getState().setPermission(permission);
}
