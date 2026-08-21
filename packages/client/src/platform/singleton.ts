import type { IJean2Platform, PlatformCapabilities } from './types';
import { createElectronAdapter } from './adapters/electron';
import { createBrowserAdapter } from './adapters/browser';
import { createVSCodeAdapter } from './adapters/vscode';

const _platform: IJean2Platform | null = null;

function detect(): IJean2Platform {
  if (typeof window === 'undefined') {
    return createBrowserAdapter();
  }
  if (window.__PROKOPAI_ELECTRON__ ?? window.__JEAN2_ELECTRON__) {
    return createElectronAdapter();
  }
  if (typeof (window as unknown as Record<string, unknown>).acquireVsCodeApi === 'function') {
    return createVSCodeAdapter();
  }
  return createBrowserAdapter();
}

export const platform: IJean2Platform = detect();

export function hasCapability<K extends keyof PlatformCapabilities>(
  key: K,
): boolean {
  return platform.capabilities[key];
}
