import { platform } from '@/platform';

/**
 * Feature support level for Web Push on this browser/platform.
 */
export type NotificationSupport =
  | 'supported'
  | 'unsupported'
  | 'insecure-context'
  | 'ios-install-required';

/**
 * Registration lifecycle state for the notification subscription.
 */
export type NotificationRegistrationState =
  | 'disabled'
  | 'enabling'
  | 'enabled'
  | 'denied'
  | 'error';

/**
 * Persisted registration metadata used to reconcile the browser
 * subscription with the designated server across foreground/launch.
 */
export interface NotificationRegistrationMeta {
  serverId: string;
  serverName: string;
  serverUrl: string;
  subscriptionId: string;
  enabledAt: number;
}

/**
 * Detect the notification support level for the current environment.
 *
 * Excludes Electron entirely from Web Push.
 * Detects insecure context (HTTP without localhost).
 * Detects iOS Safari tabs that are not installed as Home Screen apps.
 */
export function detectNotificationSupport(): NotificationSupport {
  // Exclude Electron: uses native sounds, not browser Web Push
  if (platform.id === 'electron') {
    return 'unsupported';
  }

  // Must have service worker and PushManager
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (!('PushManager' in window)) {
    return 'unsupported';
  }

  // Must have Notification API
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }

  // Must be a secure context (HTTPS or localhost)
  if (!window.isSecureContext) {
    return 'insecure-context';
  }

  // iOS Safari without Home Screen installation
  // navigator.standalone is true only for installed iOS PWAs
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isInstalled = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (isIOS && !isInstalled) {
    return 'ios-install-required';
  }

  return 'supported';
}

/**
 * Get the current OS/browser notification permission.
 */
export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') {
    return 'denied';
  }
  return Notification.permission;
}

/**
 * Serialize a browser PushSubscription into the portable SDK shape.
 */
export function serializePushSubscription(
  sub: PushSubscription,
): {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
} {
  const keys = sub.getKey ? {
    p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))),
    auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))),
  } : { p256dh: '', auth: '' };

  return {
    endpoint: sub.endpoint,
    expirationTime: sub.expirationTime,
    keys,
  };
}

/**
 * Convert a VAPID public key string to Uint8Array for PushManager.subscribe().
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

/**
 * Convert a VAPID public key string to a BufferSource for PushManager.subscribe().
 */
export function urlBase64ToApplicationServerKey(base64String: string): ArrayBuffer {
  const uint8 = urlBase64ToUint8Array(base64String);
  return uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength) as ArrayBuffer;
}
