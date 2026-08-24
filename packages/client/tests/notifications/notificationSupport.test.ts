import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { urlBase64ToUint8Array, urlBase64ToApplicationServerKey } from '@/notifications/notificationSupport';

describe('notificationSupport: urlBase64ToUint8Array', () => {
  it('decodes a valid base64url string to Uint8Array', () => {
    // "test" in base64url
    const result = urlBase64ToUint8Array('dGVzdA');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(4);
    // t, e, s, t
    expect(Array.from(result)).toEqual([116, 101, 115, 116]);
  });

  it('handles padding', () => {
    const result = urlBase64ToUint8Array('YWJjZA');
    expect(result.length).toBe(4);
    expect(Array.from(result)).toEqual([97, 98, 99, 100]); // a, b, c, d
  });
});

describe('notificationSupport: urlBase64ToApplicationServerKey', () => {
  it('returns an ArrayBuffer of the correct length', () => {
    const result = urlBase64ToApplicationServerKey('dGVzdA');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result.byteLength).toBe(4);
  });
});

describe('notificationSupport: detectNotificationSupport', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function mockWebPlatform() {
    // Stub the browser APIs that happy-dom doesn't provide
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
      writable: true,
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {},
      writable: true,
    });
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: class PushManager {},
      writable: true,
    });
    // Stub Notification API (happy-dom doesn't have it)
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: class Notification { static permission = 'default'; },
      writable: true,
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: globalThis.Notification,
      writable: true,
    });
  }

  it('returns insecure-context for HTTP without localhost', async () => {
    mockWebPlatform();
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
      writable: true,
    });
    const { detectNotificationSupport } = await import('@/notifications/notificationSupport');
    expect(detectNotificationSupport()).toBe('insecure-context');
  });

  it('returns ios-install-required for non-installed iOS', async () => {
    mockWebPlatform();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      writable: true,
    });
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      value: false,
      writable: true,
    });
    const { detectNotificationSupport } = await import('@/notifications/notificationSupport');
    expect(detectNotificationSupport()).toBe('ios-install-required');
  });

  it('returns supported for installed iOS in secure context', async () => {
    mockWebPlatform();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      writable: true,
    });
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      value: true,
      writable: true,
    });
    const { detectNotificationSupport } = await import('@/notifications/notificationSupport');
    expect(detectNotificationSupport()).toBe('supported');
  });
});
