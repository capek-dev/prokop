import { useCallback, useEffect } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { hydrateNotificationRegistration, useNotificationStore } from '@/stores/notificationStore';
import { enableNotifications, disableNotifications, updatePreferences, reconcileSubscription, initNotificationSupport } from '@/notifications/subscriptionManager';

interface ServerInfo {
  serverId: string;
  serverName: string;
  serverUrl: string;
}

/**
 * Hook providing the notification subscription lifecycle to components.
 *
 * Manages support detection, enable/disable flows, preference updates,
 * and foreground reconciliation.
 */
export function useNotifications(serverInfo: ServerInfo | null) {
  const sdkClient = useSdkClient();
  const store = useNotificationStore();

  // Initialize support detection on mount
  useEffect(() => {
    initNotificationSupport();
    void hydrateNotificationRegistration().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Notifications] Failed to restore notification registration: ${message}`);
    });
  }, []);

  // Reconcile on foreground if registered
  useEffect(() => {
    if (!store.registration || store.support !== 'supported') return;

    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void reconcileSubscription(sdkClient);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    // Also reconcile once on mount
    void reconcileSubscription(sdkClient);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [store.registration, store.support, sdkClient]);

  const enable = useCallback(async () => {
    if (!sdkClient || !serverInfo) return;
    await enableNotifications(sdkClient, serverInfo.serverId, serverInfo.serverName, serverInfo.serverUrl);
  }, [sdkClient, serverInfo]);

  const disable = useCallback(async () => {
    await disableNotifications(sdkClient);
  }, [sdkClient]);

  const updatePrefs = useCallback(async (prefs: { completion: boolean; permission: boolean }) => {
    if (!sdkClient) return;
    await updatePreferences(sdkClient, prefs);
  }, [sdkClient]);

  return {
    support: store.support,
    registrationState: store.registrationState,
    permission: store.permission,
    registration: store.registration,
    error: store.error,
    notifyCompletion: store.notifyCompletion,
    notifyPermission: store.notifyPermission,
    enable,
    disable,
    updatePrefs,
  };
}

// Re-export the store hook for convenience
export { useNotificationStore };
export type { ProkopaiClient };
