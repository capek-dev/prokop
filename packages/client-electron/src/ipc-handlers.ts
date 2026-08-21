import { ipcMain, app, BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ElectronStore from 'electron-store';
import { WebviewManager } from './webview-manager.js';
import { ServerManager } from './server-manager.js';
import { triggerUpdateCheck } from './updater.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// electron-store ESM/CJS interop: default export may be nested under `.default`
const Store = (ElectronStore as unknown as { default?: typeof ElectronStore }).default || ElectronStore;
const store = new Store({
  name: 'prokopai-config',
});

const SOUND_MAP: Record<string, string> = {
  chatFinish: 'chat-finish.mp3',
  chatPermission: 'chat-permission.mp3',
};

export function registerIpcHandlers(
  webviewManager: WebviewManager,
  serverManager: ServerManager
): void {
  ipcMain.handle('store:get', (_event, key: string) => {
    return store.get(key);
  });

  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    store.set(key, value);
  });

  ipcMain.handle('store:remove', (_event, key: string) => {
    store.delete(key);
  });

  ipcMain.handle('store:clear', () => {
    store.clear();
  });

  ipcMain.handle('window:create', () => {
    const createWindow = globalThis.__PROKOPAI_CREATE_WINDOW__;
    if (createWindow) {
      createWindow();
    }
  });

  ipcMain.handle('webview:create', (event, url: string, bounds: { x: number; y: number; width: number; height: number }) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      throw new Error('No window found for webview creation');
    }
    return webviewManager.createEmbeddedView(window, url, bounds);
  });

  ipcMain.handle('webview:remove', (_event, id: string) => {
    webviewManager.removeView(id);
  });

  ipcMain.handle('webview:resize', (_event, id: string, bounds: { x: number; y: number; width: number; height: number }) => {
    webviewManager.resizeView(id, bounds);
  });

  ipcMain.handle('webview:postMessage', (_event, id: string, message: unknown) => {
    webviewManager.postMessageToView(id, message);
  });

  ipcMain.handle('audio:play', async (_event, key: string): Promise<void> => {
    const filename = SOUND_MAP[key];
    if (!filename) {
      throw new Error(`Unknown audio key: ${key}`);
    }

    const isDev = !app.isPackaged;
    const soundPath = isDev
      ? join(__dirname, '../../client/src/assets/sounds/', filename)
      : join(process.resourcesPath, 'sounds', filename);

    let command: string;
    let args: string[];

    if (process.platform === 'darwin') {
      command = 'afplay';
      args = [soundPath];
    } else if (process.platform === 'linux') {
      command = 'aplay';
      args = [soundPath];
    } else if (process.platform === 'win32') {
      command = 'powershell';
      args = ['-c', `(New-Object Media.SoundPlayer '${soundPath}').PlaySync()`];
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        execFile(command, args, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Audio playback failed:', message);
      throw new Error(`Audio playback failed: ${message}`, { cause: err });
    }
  });

  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.handle('server:status', () => {
    return serverManager.status();
  });

  ipcMain.handle('server:start', async () => {
    return serverManager.start();
  });

  ipcMain.handle('server:stop', async () => {
    return serverManager.stop();
  });

  ipcMain.handle('updater:check', () => {
    triggerUpdateCheck();
  });

  ipcMain.on('theme:sync', (event, mode: 'dark' | 'light') => {
    if (process.platform !== 'win32') return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.setTitleBarOverlay({
      color: mode === 'dark' ? '#000000' : '#ffffff',
      symbolColor: mode === 'dark' ? '#a0a0a0' : '#3a3a3a',
    });
  });
}
