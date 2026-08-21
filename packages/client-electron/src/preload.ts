import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export interface ElectronStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProkopaiElectronAPI {
  platform: 'electron';
  store: ElectronStore;
  createWindow(): Promise<void>;
  createWebview(url: string, bounds: ViewBounds): Promise<string>;
  removeWebview(id: string): Promise<void>;
  resizeWebview(id: string, bounds: ViewBounds): Promise<void>;
  playSound(_key: string): Promise<void>;
  onAccelerator(callback: (accelerator: string) => void): () => void;
  onWebviewMessage(callback: (data: { viewId: string; message: unknown }) => void): () => void;
  onUpdaterEvent(callback: (event: { type: string; data?: unknown }) => void): () => void;
  checkForUpdates(): Promise<void>;
  getAppVersion(): Promise<string>;
  getServerStatus(): Promise<{ running: boolean; port: number }>;
  startServer(): Promise<{ port: number }>;
  stopServer(): Promise<void>;
  syncTheme(mode: 'dark' | 'light'): void;
}

const electronAPI: ProkopaiElectronAPI = {
  platform: 'electron',
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('store:remove', key),
    clear: () => ipcRenderer.invoke('store:clear'),
  },
  createWindow: () => ipcRenderer.invoke('window:create'),
  createWebview: (url: string, bounds: ViewBounds) =>
    ipcRenderer.invoke('webview:create', url, bounds),
  removeWebview: (id: string) => ipcRenderer.invoke('webview:remove', id),
  resizeWebview: (id: string, bounds: ViewBounds) =>
    ipcRenderer.invoke('webview:resize', id, bounds),
  playSound: (key: string) => ipcRenderer.invoke('audio:play', key),
  onAccelerator: (callback: (accelerator: string) => void) => {
    const handler = (_event: IpcRendererEvent, accelerator: string) => {
      callback(accelerator);
    };
    ipcRenderer.on('accelerator', handler);
    return () => {
      ipcRenderer.removeListener('accelerator', handler);
    };
  },
  onWebviewMessage: (
    callback: (data: { viewId: string; message: unknown }) => void
  ) => {
    const handler = (_event: IpcRendererEvent, data: { viewId: string; message: unknown }) => {
      callback(data);
    };
    ipcRenderer.on('webview:message', handler);
    return () => {
      ipcRenderer.removeListener('webview:message', handler);
    };
  },
  onUpdaterEvent: (callback: (event: { type: string; data?: unknown }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { type: string; data?: unknown }) => {
      callback(data);
    };
    ipcRenderer.on('updater:event', handler);
    return () => {
      ipcRenderer.removeListener('updater:event', handler);
    };
  },
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getServerStatus: () => ipcRenderer.invoke('server:status'),
  startServer: () => ipcRenderer.invoke('server:start'),
  stopServer: () => ipcRenderer.invoke('server:stop'),
  syncTheme: (mode: 'dark' | 'light') => ipcRenderer.send('theme:sync', mode),
};

// Expose the API to the renderer process. Both the canonical and the
// legacy global are exposed so an older bundled client build still finds
// its Electron bridge during the rename transition.
contextBridge.exposeInMainWorld('__PROKOPAI_ELECTRON__', electronAPI);
contextBridge.exposeInMainWorld('__JEAN2_ELECTRON__', electronAPI);

// Type declaration for the renderer
declare global {
  interface Window {
    __PROKOPAI_ELECTRON__?: ProkopaiElectronAPI;
    __JEAN2_ELECTRON__?: ProkopaiElectronAPI;
  }
}
