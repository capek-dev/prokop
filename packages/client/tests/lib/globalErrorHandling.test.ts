import { describe, expect, test } from 'vitest';
import { isResizeObserverDeliveryWarning } from '@/lib/globalErrorHandling';

describe('isResizeObserverDeliveryWarning', () => {
  test.each([
    'ResizeObserver loop completed with undelivered notifications.',
    'ResizeObserver loop limit exceeded',
  ])('accepts the browser delivery warning: %s', (message) => {
    expect(isResizeObserverDeliveryWarning(new ErrorEvent('error', { message }))).toBe(true);
  });

  test('does not hide a real exception with a similar message', () => {
    const error = new Error('ResizeObserver loop completed with undelivered notifications.');
    const event = new ErrorEvent('error', { message: error.message, error });

    expect(isResizeObserverDeliveryWarning(event)).toBe(false);
  });

  test('does not hide unrelated window errors', () => {
    expect(isResizeObserverDeliveryWarning(new ErrorEvent('error', {
      message: 'Application failed',
    }))).toBe(false);
  });
});
