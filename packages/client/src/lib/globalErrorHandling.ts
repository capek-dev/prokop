const RESIZE_OBSERVER_DELIVERY_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

/**
 * Chromium reports delayed ResizeObserver delivery as an ErrorEvent without an
 * Error object. The browser delivers the pending notifications in a later
 * frame, so this warning must not enter the app error or development overlay
 * path. All other window errors continue through normal reporting.
 */
export function isResizeObserverDeliveryWarning(event: ErrorEvent): boolean {
  return (
    (event.error === undefined || event.error === null) &&
    RESIZE_OBSERVER_DELIVERY_MESSAGES.has(event.message)
  );
}
