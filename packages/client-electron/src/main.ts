import { app, BrowserWindow, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { setupMenu } from './menu.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { setupUpdater } from './updater.js';
import { ServerManager } from './server-manager.js';
import { WebviewManager } from './webview-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
}

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let webviewManager: WebviewManager;
let serverManager: ServerManager;

function getClientUrl(): string {
  if (isDev) {
    return 'http://localhost:5173';
  }

  if (app.isPackaged) {
    const clientPath = join(process.resourcesPath, 'client', 'dist', 'index.html');
    return pathToFileURL(clientPath).href;
  }

  const clientPath = join(__dirname, '..', 'client', 'dist', 'index.html');
  return pathToFileURL(clientPath).href;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 500,
    minHeight: 600,
    show: false,
    center: true,
    resizable: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: true,
    backgroundColor: '#00000000',
    icon: isDev ? join(__dirname, '..', 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Security: prevent uncontrolled webview tags
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  // Security: intercept navigation to control what can be loaded
  window.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:5173')) {
      return;
    }
    if (!isDev && (url.startsWith('http://') || url.startsWith('https://'))) {
      event.preventDefault();
    }
  });

  // Handle external links - open in default browser
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Allow webview URLs if they were created through our webview manager
    if (webviewManager && webviewManager.isManagedUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  // Load the client
  const clientUrl = getClientUrl();
  console.log(`[Prokopai] Loading client from: ${clientUrl}`);
  window.loadURL(clientUrl);

  window.webContents.on('did-finish-load', () => {
    console.log('[Prokopai] Client loaded successfully');
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Prokopai] Failed to load: ${errorCode} ${errorDescription} URL: ${validatedURL}`);
  });

  // Open DevTools in development
  if (isDev) {
    window.webContents.openDevTools();
  }

  return window;
}

function createSecondaryWindow(): BrowserWindow {
  return createWindow();
}

// Export for IPC handler
globalThis.__PROKOPAI_CREATE_WINDOW__ = createSecondaryWindow;

app.whenReady().then(() => {
  console.log('[Prokopai] Application starting...');

  // Initialize managers
  webviewManager = new WebviewManager();
  serverManager = new ServerManager();

  // Register IPC handlers
  registerIpcHandlers(webviewManager, serverManager);

  // Set up the application menu
  setupMenu(createSecondaryWindow);

  // Create the main window
  mainWindow = createWindow();

  // Set up auto-updater (only in production)
  if (!isDev) {
    setupUpdater(mainWindow);
  }

  console.log('[Prokopai] Application ready');
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running even when all windows are closed
  // It will be quit explicitly via Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS, re-create a window when the dock icon is clicked
  // and no other windows are open
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

// Handle second instance - focus existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

// Handle quit on macOS when all windows are closed
app.on('before-quit', () => {
  console.log('[Prokopai] Application quitting...');

  // Stop the server if running
  if (serverManager) {
    serverManager.stop();
  }

  // Clean up webviews
  if (webviewManager) {
    webviewManager.removeAllViews();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Prokopai] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Prokopai] Unhandled rejection:', reason);
});
