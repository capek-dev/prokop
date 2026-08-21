# Jean2 Client

Cross-platform frontend for the Jean2 AI Agent. Connects to a Jean2 server over WebSocket and REST API for real-time AI chat sessions with tool execution, multi-workspace support, and multi-server management.

Three deployment targets:

- **Web / PWA** — Browser-based with offline support and installable as a PWA
- **Electron Desktop** — Native macOS and Windows application with multi-window support
- **Web CLI** — Run locally via `npx @prokopai/client`

## Features

- Streaming chat with real-time message updates and token usage display
- Multi-model and multi-provider selection (budget/standard/premium tiers)
- Session management — create, close, reopen, rename, fork, compact, and revert
- Multi-server and multi-workspace support with quick switching
- Tool permission approval flow with grant scope options (once, session, workspace, always)
- File tree browser and file path autocomplete
- MCP (Model Context Protocol) server management
- Queued messages when a session is busy streaming
- Built-in remote terminal with multi-tab support and session reconnection
- Offline detection with exponential backoff auto-reconnect
- Dark and light themes (persists per platform)
- Responsive layout — works on desktop and mobile viewports
- Two view modes — Default (session list) and Overview (multi-workspace dashboard with Quick Switcher)
- PWA support — install to home screen on mobile and desktop

## Prerequisites

- [Bun](https://bun.sh/)

## Development

```bash
# Install dependencies (from repo root)
bun install

# Start Vite dev server (port 5173, proxies to server on port 3000)
bun run dev
```

The Vite dev server proxies `/api` and `/ws` to `http://localhost:3000`.

## Building

### Web / PWA

```bash
bun run build
# Output: dist/
```

### CLI / npx

```bash
bun run build:npx
# Output: dist/cli.mjs (bundled Node.js server)
```

## Running via npx

```bash
npx @prokopai/client
# Opens browser to http://localhost:3774

# Custom port
npx @prokopai/client --port 8080
```

The CLI bundles the built web assets and serves them with a static Node.js HTTP server.

## Project Structure

```
packages/client/
  src/
    App.tsx              Root component, WebSocket + REST state management
    main.tsx             Entry point, ThemeProvider wrapper
    cli.ts               npx CLI — static file server
    index.css            Tailwind v4, theme tokens, responsive utilities
    components/
      chat/              ChatView, MessageBubble, MessageInput, ToolCall, etc.
      layout/            AppSidebar, QuickSwitcher, WorkspaceSwitcher, FilesPanel
      modals/            SettingsDialog, MCPManagementDialog, AddServerDialog
      visualizations/    CodeBlock, DiffViewer, TerminalOutput, TodoList, etc.
      shared/            MarkdownRenderer, ThemeToggle, EmptyState, OfflineState
      files/             FileTree, FileTreeNode, FileAutocomplete
      providers/         ThemeProvider
      ui/                shadcn/ui primitives (button, dialog, sidebar, etc.)
    contexts/
      ServerContext.tsx   Multi-server state, quick connections
    hooks/
      useApi.ts          Authenticated fetch helper
      useFileSearch.ts   File search utility
      useLocalStorage.ts LocalStorage hook
      use-mobile.ts      Mobile viewport detection
    config/
      auth.ts            Token validation, URL normalization
      servers.ts         Server CRUD in localStorage
    lib/
      utils.ts           cn() and Tailwind merge
      storage.ts         Platform-agnostic storage (Electron store / localStorage)
      path.ts            Path utilities
    utils/
      diff.ts            Diff parsing utilities
  public/
    favicon.ico          Favicon
    icon-192.png         PWA icon (small)
    icon-512.png         PWA icon (large)
    apple-touch-icon.png iOS home screen icon
  components.json        shadcn/ui configuration (radix-nova style)
  vite.config.ts         Vite — React, Tailwind, path aliases, dev proxy, PWA
  package.npm.json       Minimal manifest for npm publish (CLI mode)
  VERSION                Client version
```

## Technology Stack

| Layer        | Technology                                  |
| ------------ | ------------------------------------------- |
| Framework    | React 19                                    |
| Build        | Vite 6, TypeScript                          |
| Styling      | Tailwind CSS v4, shadcn/ui, Radix UI        |
| Fonts        | Geist Variable                              |
| Icons        | Lucide React                                |
| Desktop      | Electron — macOS, Windows                   |
| Mobile       | Web / PWA                                   |
| Markdown     | react-markdown + remark-gfm                 |
| Code blocks  | prism-react-renderer                        |
| Storage      | localStorage (web) / Electron store (desktop) |
| CLI          | esbuild bundle, Node.js http module         |

## Architecture

The client connects to a Jean2 server via WebSocket (`ws://host:port/ws?token=...`) for real-time events and REST (`http://host:port/api`) for initial data loading. Authentication is optional — when the server has `PROKOPAI_AUTH_TOKEN` set, all requests require the bearer token. When not set, all requests pass through without authentication.

**WebSocket protocol** handles session CRUD, message streaming (including delta-based text append), part creation/updates, ask requests (permissions, questions, forms, client capabilities), permission responses, queue management, usage tracking, and compaction events. The `App.tsx` handler dispatches all `ServerMessage` types into React state.

**Multi-server support** allows connecting to multiple Jean2 server instances. Servers are persisted in localStorage. Switching servers clears all session state and reconnects.

**Multi-workspace support** isolates sessions by workspace. The active workspace is persisted and restored on reload.

**Platform abstraction** — the `storage` module (`lib/storage.ts`) transparently uses the Electron IPC store on desktop and falls back to localStorage on web/PWA. The Electron layer adds native-only features like multi-window (`Cmd+N`).
