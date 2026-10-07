import { registerSW } from 'virtual:pwa-register';

import { setupServiceWorkerUpdateChecks } from './updateChecks';
import { usePWAUpdateStore } from './updateStore';
import { isSameOriginRoute, normalizeRoute } from './sw-logic';

let stopUpdateChecks: (() => void) | undefined;

function handleServiceWorkerMessage(event: MessageEvent<unknown>): void {
  if (typeof event.data !== 'object' || event.data === null) {
    return;
  }

  const message = event.data as { type?: unknown; route?: unknown };
  if (message.type !== 'NAVIGATE_TO_NOTIFICATION' || typeof message.route !== 'string') {
    return;
  }
  if (!isSameOriginRoute(message.route, window.location.origin)) {
    return;
  }

  const target = normalizeRoute(message.route, window.location.origin);
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current !== target) {
    window.location.assign(target);
  }
}

function clearAppBadge(): void {
  try {
    const nav = navigator as Navigator & {
      clearAppBadge?: () => Promise<void>;
    };
    void nav.clearAppBadge?.().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[PWA] Failed to clear app badge: ${message}`);
    });

    const worker = navigator.serviceWorker.controller;
    worker?.postMessage({ type: 'CLEAR_APP_BADGE' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[PWA] Failed to clear app badge: ${message}`);
  }
}

export function registerProkopServiceWorker(): void {
  navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePWAUpdateStore.getState().markNeedRefresh();
    },
    onOfflineReady() {
      usePWAUpdateStore.getState().markOfflineReady();
    },
    onRegisteredSW(serviceWorkerUrl, registration) {
      stopUpdateChecks?.();
      if (!registration) {
        console.error('[PWA] Service worker registration completed without a registration object');
        return;
      }
      stopUpdateChecks = setupServiceWorkerUpdateChecks(
        serviceWorkerUrl,
        registration,
        undefined,
        undefined,
        usePWAUpdateStore.getState().showOnForeground,
      );
    },
    onRegisterError(err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[PWA] Service worker registration failed: ${message}`);
    },
  });

  usePWAUpdateStore.getState().setServiceWorkerUpdater(updateServiceWorker);

  const clearBadgeWhenVisible = (): void => {
    if (document.visibilityState === 'visible') {
      clearAppBadge();
    }
  };

  window.addEventListener('focus', clearAppBadge);
  document.addEventListener('visibilitychange', clearBadgeWhenVisible);
  clearBadgeWhenVisible();
}
