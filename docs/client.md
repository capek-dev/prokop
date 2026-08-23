# Client Guide

The Jean2 server exposes a REST API and WebSocket endpoint. Any client that speaks these protocols can connect. Here are the official options.

## Built-in Client

The server binary contains the production client and serves it from the same origin as the API and WebSocket endpoint. This is the recommended way to connect:

```bash
jean2 start
jean2 open
```

Then visit `http://localhost:8742` in your browser. Changing the server port changes the client URL too.

## PWA (any device)

The web client is a Progressive Web App. Open it once in your browser, and it's available offline:

- **Desktop**: Click the install icon in the address bar
- **iOS**: Tap Share → Add to Home Screen
- **Android**: Tap the install banner or menu → Add to Home Screen

The PWA caches assets locally and works even without an internet connection to the client CDN. (You still need a connection to your Jean2 server.)

## Desktop App (macOS)

The Electron desktop app provides a native experience with system tray, notifications, and auto-updates. Download from [GitHub Releases](https://github.com/jean2ai/jean2/releases), install, and launch it. It connects to the server on port **8742** (configurable via `JEAN2_PORT`).

## Browser Extension

The [Jean2Browser](https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj) extension lets the agent control a Chrome browser: navigate pages, read content, and click elements. Install it from the Chrome Web Store, then connect it to your Jean2 server from the extension popup.

## Connecting to a Remote Server

The client opens a connection finder automatically. You can also:

1. Click the server switcher in the sidebar
2. Enter the server URL (e.g., `https://my-vps.example.com:8742`)
3. If auth is enabled, enter the token

Jean2 works over:
- **Local network**: `http://192.168.1.x:8742`
- **Tailscale / VPN**: `http://jean2-server:8742`
- **Public internet**: requires TLS and auth. Set up a reverse proxy (nginx, Caddy) with HTTPS, then point the client at the domain.

## Client Features

Once connected, the client provides:

### Chat
- Message input with file mentions (`@filename`)
- Model and reasoning variant selector
- **Goal Mode** - Autonomous multi-turn loops with evaluator-verified completion
- **Preconfig switching** - Swap model, tools, prompt, and skills mid-session
- Auto-approve toggle for non-destructive tool calls
- Session control (interrupt, fork, revert)
- Token usage meter

### Files
- File tree browser for the active workspace
- File preview with syntax highlighting
- File autocomplete in chat input

### Terminal
- Full PTY terminal sessions
- Multi-tab support
- Terminal output visualization in chat

### Configuration
- Model management (via Configuration dialog)
- **MCP server management** - Connect, configure, monitor status
- **Preconfig editor** - System prompts, tool sets, skills scoping, subagent rules
- Provider credential management
- **Workspace capabilities** - Toggle memory, skills, workflow, session search
- **Workspace permissions** - View and revoke tool grants
- **OAuth** - Connect ChatGPT subscription plan

### Sessions
- Fork any session at any message
- Revert to any previous point
- Interrupt running generations
- Compact long conversations
- Queue messages while the agent is busy
