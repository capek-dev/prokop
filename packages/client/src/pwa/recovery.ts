const JEAN2_RUNTIME_CACHES = new Set([
  'static-assets',
  'static-media',
  'html-cache',
]);

function reloadPage(): void {
  window.location.reload();
}

export function isLikelyStaleBuildError(value: unknown): boolean {
  const error = value instanceof Error ? value : new Error(String(value));
  const details = `${error.name} ${error.message} ${error.stack ?? ''}`.toLowerCase();

  return details.includes('failed to fetch dynamically imported module')
    || details.includes('error loading dynamically imported module')
    || details.includes('chunkloaderror')
    || details.includes('loading chunk')
    || (details.includes('mime') && details.includes('text/html'))
    || details.includes("unexpected token '<'");
}

export function isProkopCache(cacheName: string): boolean {
  return cacheName.startsWith('workbox-precache-') || JEAN2_RUNTIME_CACHES.has(cacheName);
}

export async function reloadProkop(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    window.location.reload();
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) {
      window.location.reload();
      return;
    }

    let reloading = false;
    const reload = (): void => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.setTimeout(reload, 3000);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PWA] Failed to activate update during recovery: ${message}`);
    window.location.reload();
  }
}

export async function resetDownloadedAppFiles(): Promise<void> {
  if (!('caches' in window)) {
    reloadPage();
    return;
  }

  try {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter(isProkopCache)
        .map((cacheName) => window.caches.delete(cacheName)),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PWA] Failed to reset downloaded app files: ${message}`);
  }

  window.location.reload();
}
