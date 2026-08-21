import type { ProkopaiElectronAPI } from './preload.js';

declare global {
  interface Window {
    __PROKOPAI_ELECTRON__?: ProkopaiElectronAPI;
  }

  var __PROKOPAI_CREATE_WINDOW__: (() => import('electron').BrowserWindow) | undefined;
}

export {};
