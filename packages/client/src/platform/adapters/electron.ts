import type { IJean2Platform, PlatformSoundKey } from '../types';

export function createElectronAdapter(): IJean2Platform {
  const api = window.__PROKOPAI_ELECTRON__ ?? window.__JEAN2_ELECTRON__!;

  return {
    id: 'electron',

    capabilities: {
      storage: true,
      sound: true,
      themeSync: true,
      windowManagement: true,
      webviews: true,
      serverManagement: true,
      updater: true,
      accelerators: true,
      fileOpen: false,
      terminal: false,
      workspacePath: false,
      explorer: false,
      serverSwitching: true,
      multiView: true,
    },

    storage: {
      get: <T>(key: string) => api.store.get(key) as Promise<T | null>,
      set: <T>(key: string, value: T) => api.store.set(key, value),
      remove: (key: string) => api.store.remove(key),
      clear: () => api.store.clear(),
    },

    playSound: (key: PlatformSoundKey) => api.playSound(key),

    syncTheme: (mode) => {
      if (mode !== 'system') {
        api.syncTheme(mode);
      }
    },

    onAccelerator: (cb) => api.onAccelerator(cb),

    createWindow: () => api.createWindow(),

    createWebview: (url, bounds) => api.createWebview(url, bounds),

    removeWebview: (id) => api.removeWebview(id),

    resizeWebview: (id, bounds) => api.resizeWebview(id, bounds),

    onWebviewMessage: (cb) =>
      (api as unknown as {
        onWebviewMessage(cb: (data: { viewId: string; message: unknown }) => void): () => void;
      }).onWebviewMessage((data) => cb(data.viewId, data.message)),

    onUpdaterEvent: (cb) => api.onUpdaterEvent(cb),

    checkForUpdates: () => api.checkForUpdates(),

    getAppVersion: () => api.getAppVersion(),

    getServerStatus: () => api.getServerStatus(),

    startServer: () => api.startServer(),

    stopServer: () => api.stopServer(),
  };
}
