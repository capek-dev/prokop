// First: settles the launch URL (resume, shortcut action) before the router reads it.
import { installLaunchQueue } from '@/lib/launchState';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { ThemedToaster } from '@/components/providers/ThemedToaster';
import { PWAUpdateBanner } from '@/components/app/PWAUpdateBanner';
import { TitleTooltipLayer } from '@/components/shared/TitleTooltipLayer';
import { RouterApp, router } from './router';
import { registerProkopServiceWorker } from '@/pwa/registerServiceWorker';
import { startSessionCacheSync } from '@/lib/sessionCacheSync';
import { isResizeObserverDeliveryWarning } from '@/lib/globalErrorHandling';
import { preloadPierreDiffsHighlighter } from '@/lib/pierreDiffsPreload';
import { startPierreWorkerPool } from '@/lib/pierreWorkerPool';
import { PierreWorkerPoolProvider } from '@/components/providers/PierreWorkerPoolProvider';
import PierreDiffsWorker from '@pierre/diffs/worker/worker.js?worker';
import { installDesktopChrome, requestPersistentStorage } from '@/lib/desktopChrome';
import './index.css';

// Warm the shared Pierre diffs highlighter before any code surface mounts,
// so the first diff/code block never renders empty (see module comment).
// Must run before the worker pool starts: workers copy the custom extension
// map (.kt/.kts) at initialization.
preloadPierreDiffsHighlighter();

// Move highlighting off the main thread once startup work is done. Surfaces
// mounted before the pool is ready keep main-thread highlighting.
const startWorkers = () => void startPierreWorkerPool(() => new PierreDiffsWorker());
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(startWorkers, { timeout: 2000 });
} else {
  setTimeout(startWorkers, 500);
}

// Global error handlers for debugging uncaught errors
window.addEventListener('error', (event) => {
  if (isResizeObserverDeliveryWarning(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  console.error('[Global] Uncaught error:', event.error || event.message);
  console.error('[Global] Error stack:', event.error?.stack);
}, { capture: true });
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Global] Unhandled rejection:', event.reason);
  console.error('[Global] Rejection stack:', event.reason?.stack);
});

installDesktopChrome();
void requestPersistentStorage();
installLaunchQueue((href) => { void router.navigate({ href }); });

registerProkopServiceWorker();

// The query cache owns session-list hydration into the session read-model.
startSessionCacheSync();

function App() {
  return (
    <ErrorBoundary>
      <PWAUpdateBanner />
      <RouterApp />
      <TitleTooltipLayer />
    </ErrorBoundary>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryProvider>
        <ThemeProvider defaultMode="system" defaultScheme="neutral">
          <PierreWorkerPoolProvider>
            <App />
          </PierreWorkerPoolProvider>
          <ThemedToaster />
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
);
