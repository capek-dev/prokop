import type { DeviceKind } from '@prokopai/sdk';

/** Human-readable name shown to the person approving this device, e.g. "iPhone (Safari)". */
export function describeThisDevice(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): {
  label: string;
  deviceKind: DeviceKind;
} {
  const ua = userAgent;
  const device = /iPad/.test(ua) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
          : /Windows/.test(ua) ? 'Windows PC'
            : /Linux/.test(ua) ? 'Linux'
              : 'Browser';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : null;
  const deviceKind: DeviceKind = device === 'iPad' || (/Android/.test(ua) && !/Mobile/.test(ua)) ? 'tablet'
    : device === 'iPhone' || device === 'Android' ? 'mobile'
      : device === 'Browser' ? 'unknown'
        : 'desktop';
  return { label: browser ? `${device} (${browser})` : device, deviceKind };
}
