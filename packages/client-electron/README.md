# Jean2 Electron Client

The Electron desktop shell for the Jean2 AI Agent application.

## Overview

This package provides the Electron-based desktop wrapper for the Jean2 React client. It enables:

- **Native Desktop Experience**: Full desktop integration with native menus, multi-window support, and keyboard accelerators
- **Embedded Web Views**: Browser-like feature for loading arbitrary URLs within the main window
- **Offline Mode**: Optionally bundles and spawns the Jean2 server binary locally
- **Auto-Updates**: Automatic updates via electron-updater (GitHub Releases)
- **Cross-Platform**: Builds for macOS and Windows (unsigned)

## Prerequisites

- Node.js 18+
- Bun runtime
- For building: Xcode command line tools (macOS), Visual Studio Build Tools (Windows)

## Installation

```bash
cd packages/client-electron
bun install
```

## Development

### Running in Development Mode

Start the Vite dev server and Electron together:

```bash
bun run electron:dev
```

This will:
1. Start the Vite dev server on http://localhost:5173
2. Launch Electron with the React client from the dev server
3. Enable DevTools for debugging

### Running the React Client Separately

```bash
# Terminal 1: Start the React client dev server
cd packages/client && bun run dev

# Terminal 2: Start Electron
cd packages/client-electron && bun run electron:dev
```

## Building

### Build All Platforms

```bash
bun run electron:build
```

### Build for Specific Platforms

```bash
# macOS (local development - no signing)
bun run electron:build:mac:local

# macOS (release build with signing & notarization)
bun run electron:build:mac:release

# Windows (unsigned)
bun run electron:build:win
```

### Type Checking

```bash
bun run typecheck
```

## Project Structure

```
packages/client-electron/
├── src/
│   ├── main.ts           # Electron main process entry point
│   ├── preload.ts       # Preload script with context bridge
│   ├── menu.ts           # Native application menu setup
│   ├── ipc-handlers.ts   # IPC handler registration
│   ├── webview-manager.ts # Embedded web views management
│   ├── server-manager.ts # Local server process management
│   ├── updater.ts        # Auto-update functionality
│   ├── renderer.ts       # Placeholder for Vite dev server
│   └── index.html        # HTML entry point for Vite
├── build/
│   └── entitlements.mac.plist # macOS entitlements
├── electron-builder.yml  # Build configuration
├── tsconfig.json
├── vite.config.ts
└── package.json
```

## API Reference

The preload script exposes `window.__PROKOPAI_ELECTRON__` with the following interface:

### Platform

```typescript
interface Jean2ElectronAPI {
  platform: 'electron';  // Always 'electron' when running in Electron
  // ...
}
```

### Store

Persistent key-value storage using electron-store:

```typescript
await window.__PROKOPAI_ELECTRON__.store.get('key');
await window.__PROKOPAI_ELECTRON__.store.set('key', { value: 123 });
await window.__PROKOPAI_ELECTRON__.store.remove('key');
await window.__PROKOPAI_ELECTRON__.store.clear();
```

### Windows

```typescript
// Create a new window
await window.__PROKOPAI_ELECTRON__.createWindow();
```

### Web Views

```typescript
interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Create an embedded web view
const viewId = await window.__PROKOPAI_ELECTRON__.createWebview('https://example.com', {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
});

// Resize an existing view
await window.__PROKOPAI_ELECTRON__.resizeWebview(viewId, {
  x: 100,
  y: 100,
  width: 600,
  height: 400,
});

// Remove a view
await window.__PROKOPAI_ELECTRON__.removeWebview(viewId);
```

### Accelerators

Listen for menu accelerator events:

```typescript
const unsubscribe = window.__PROKOPAI_ELECTRON__.onAccelerator((accelerator) => {
  switch (accelerator) {
    case 'toggle-sidebar':
      // Handle sidebar toggle
      break;
    case 'toggle-terminal':
      // Handle terminal toggle
      break;
  }
});

// Clean up
unsubscribe();
```

### Server Management

```typescript
// Get server status
const status = await window.__PROKOPAI_ELECTRON__.getServerStatus();
console.log(status.running, status.port);

// Start local server
const { port } = await window.__PROKOPAI_ELECTRON__.startServer();

// Stop local server
await window.__PROKOPAI_ELECTRON__.stopServer();
```

### Auto-Updates

Listen for updater events:

```typescript
const unsubscribe = window.__PROKOPAI_ELECTRON__.onUpdaterEvent((event) => {
  switch (event.type) {
    case 'checking':
      console.log('Checking for updates...');
      break;
    case 'available':
      console.log('Update available:', event.data);
      break;
    case 'download-progress':
      console.log('Download progress:', event.data);
      break;
    case 'downloaded':
      console.log('Update downloaded:', event.data);
      break;
    case 'error':
      console.error('Update error:', event.data);
      break;
  }
});

unsubscribe();
```

### App Info

```typescript
const version = await window.__PROKOPAI_ELECTRON__.getAppVersion();
```

## Keyboard Shortcuts

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New Window | Cmd+N | Ctrl+N |
| Close Window | Cmd+W | Ctrl+W |
| Toggle Sidebar | Cmd+1 | Ctrl+1 |
| Toggle Terminal | Cmd+T | Ctrl+T |
| Toggle DevTools | Alt+Cmd+I | Ctrl+Shift+I |
| Toggle Fullscreen | F11 | F11 |
| Quit | Cmd+Q | Alt+F4 |

## Configuration

Configuration is stored in `electron-store` under the app data directory:

- **macOS**: `~/Library/Application Support/Jean2/`
- **Windows**: `%APPDATA%/Jean2/`

## Building for Distribution

The build outputs go to `packages/client-electron/release/`:

- **macOS**: `.dmg` and `.zip` files
- **Windows**: `.exe` (NSIS installer) and `.exe` (portable)

## Troubleshooting

### Server Binary Not Found

If you see "Server binary not found" warnings in offline mode:
1. Ensure the server package is built: `cd packages/server && bun run build`
2. The server should be in `packages/server/dist/`

### Build Errors

If you encounter build errors:
1. Clean the build cache: `rm -rf packages/client-electron/release`
2. Rebuild: `bun run electron:build`

### Auto-Update Issues

If updates fail to check:
1. Verify the GitHub repository is set correctly in `electron-builder.yml`
2. Check network connectivity
3. Review logs in `electron-log` output

## License

MIT
