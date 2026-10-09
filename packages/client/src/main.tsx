import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { ThemedToaster } from '@/components/providers/ThemedToaster';
import { PWAUpdateBanner } from '@/components/app/PWAUpdateBanner';
import { TitleTooltipLayer } from '@/components/shared/TitleTooltipLayer';
import { RouterApp } from './router';
import { registerProkopServiceWorker } from '@/pwa/registerServiceWorker';
import { startSessionCacheSync } from '@/lib/sessionCacheSync';
import { isResizeObserverDeliveryWarning } from '@/lib/globalErrorHandling';
import { preloadPierreDiffsHighlighter } from '@/lib/pierreDiffsPreload';
import { installDesktopChrome } from '@/lib/desktopChrome';
import './index.css';

// Warm the shared Pierre diffs highlighter before any code surface mounts,
// so the first diff/code block never renders empty (see module comment).
preloadPierreDiffsHighlighter();

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
          <App />
          <ThemedToaster />
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
);
