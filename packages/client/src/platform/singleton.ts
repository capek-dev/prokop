import type { IJean2Platform, PlatformCapabilities } from './types';
import { createElectronAdapter } from './adapters/electron';
import { createBrowserAdapter } from './adapters/browser';

const _platform: IJean2Platform | null = null;

function detect(): IJean2Platform {
  if (typeof window === 'undefined') {
    return createBrowserAdapter();
  }
  if (window.__PROKOPAI_ELECTRON__ ?? window.__JEAN2_ELECTRON__) {
    return createElectronAdapter();
  }
  return createBrowserAdapter();
}

export const platform: IJean2Platform = detect();

export function hasCapability<K extends keyof PlatformCapabilities>(
  key: K,
): boolean {
  return platform.capabilities[key];
}
