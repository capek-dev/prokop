interface ProkopaiElectronAPI {
  platform: 'electron';
  store: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    remove(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  createWindow(): Promise<void>;
  createWebview(url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<string>;
  removeWebview(id: string): Promise<void>;
  resizeWebview(id: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>;
  playSound(key: string): Promise<void>;
  onAccelerator(callback: (action: string) => void): () => void;
  onWebviewMessage(callback: (viewId: string, data: unknown) => void): () => void;
  onUpdaterEvent(callback: (event: { type: string; data?: unknown }) => void): () => void;
  checkForUpdates(): Promise<void>;
  getAppVersion(): Promise<string>;
  getServerStatus(): Promise<{ running: boolean; port: number }>;
  startServer(): Promise<number>;
  stopServer(): Promise<void>;
  syncTheme(mode: 'dark' | 'light'): void;
}

declare global {
  interface Window {
    __PROKOPAI_ELECTRON__?: ProkopaiElectronAPI;
    __JEAN2_ELECTRON__?: ProkopaiElectronAPI;
  }
}

export {};
