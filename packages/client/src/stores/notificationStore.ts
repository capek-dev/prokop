import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import type {
  NotificationSupport,
  NotificationRegistrationState,
  NotificationRegistrationMeta,
} from '@/notifications/notificationSupport';
import { storage } from '@/lib/storage';

const STORAGE_KEY = 'prokopai_notification_registration';

interface NotificationStore {
  support: NotificationSupport;
  registrationState: NotificationRegistrationState;
  permission: NotificationPermission;
  registration: NotificationRegistrationMeta | null;
  error: string | null;
  // Preferences
  notifyCompletion: boolean;
  notifyPermission: boolean;

  setSupport: (support: NotificationSupport) => void;
  setRegistrationState: (state: NotificationRegistrationState) => void;
  setPermission: (permission: NotificationPermission) => void;
  setRegistration: (reg: NotificationRegistrationMeta | null) => void;
  setError: (error: string | null) => void;
  setNotifyCompletion: (enabled: boolean) => void;
  setNotifyPermission: (enabled: boolean) => void;
  reset: () => void;
}

async function loadRegistration(): Promise<NotificationRegistrationMeta | null> {
  return storage.get<NotificationRegistrationMeta>(STORAGE_KEY);
}

async function persistRegistration(reg: NotificationRegistrationMeta | null): Promise<void> {
  if (reg) {
    await storage.set(STORAGE_KEY, reg);
  } else {
    await storage.remove(STORAGE_KEY);
  }
}

function loadBoolean(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val === 'true';
  } catch {
    return fallback;
  }
}

export const useNotificationStore: UseBoundStore<StoreApi<NotificationStore>> = create<NotificationStore>((set) => ({
  support: 'unsupported',
  registrationState: 'disabled',
  permission: 'denied',
  registration: null,
  error: null,
  notifyCompletion: loadBoolean('prokopai_notify_completion', true),
  notifyPermission: loadBoolean('prokopai_notify_permission', true),

  setSupport: (support) => set({ support }),
  setRegistrationState: (registrationState) => set({ registrationState }),
  setPermission: (permission) => set({ permission }),
  setRegistration: (reg) => {
    void persistRegistration(reg);
    set({
      registration: reg,
      registrationState: reg ? 'enabled' : 'disabled',
    });
  },
  setError: (error) => set({ error }),
  setNotifyCompletion: (enabled) => {
    try { localStorage.setItem('prokopai_notify_completion', String(enabled)); } catch { /* ignore */ }
    set({ notifyCompletion: enabled });
  },
  setNotifyPermission: (enabled) => {
    try { localStorage.setItem('prokopai_notify_permission', String(enabled)); } catch { /* ignore */ }
    set({ notifyPermission: enabled });
  },
  reset: () => {
    void persistRegistration(null);
    set({
      registrationState: 'disabled',
      registration: null,
      error: null,
    });
  },
}));

/**
 * Hydrate persisted registration metadata from storage into the store.
 * Call on app startup or when the active server changes.
 */
export async function hydrateNotificationRegistration(): Promise<void> {
  const reg = await loadRegistration();
  if (reg) {
    useNotificationStore.setState({
      registration: reg,
      registrationState: 'enabled',
    });
  }
}
