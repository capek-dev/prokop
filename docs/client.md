# Client Guide

The Prokop server exposes a REST API and WebSocket endpoint. Any client that speaks these protocols can connect. Here are the official options.

## Built-in Client

The server binary contains the production client and serves it from the same origin as the API and WebSocket endpoint. This is the recommended way to connect:

```bash
prokop start
prokop open
```

Then visit `http://localhost:8742` in your browser. Changing the server port changes the client URL too.

## PWA (any device)

The web client is a Progressive Web App. Open it once in your browser, and it's available offline:

- **Desktop**: Click the install icon in the address bar
- **iOS**: Tap Share → Add to Home Screen
- **Android**: Tap the install banner or menu → Add to Home Screen

The PWA caches assets locally after the first load. You still need a connection to your Prokop server.

## Browser Extension

The [ProkopaiBrowser](https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj) extension lets the agent control a Chrome browser: navigate pages, read content, and click elements. Install it from the Chrome Web Store, then connect it to your Prokop server from the extension popup.

## Connecting to a Remote Server

First turn on remote access on that machine (**Settings → Devices → Remote access**, or `prokop remote`), then either:

- Open its address on the other device. The device asks for approval and shows a four-digit code; approve it on the machine.
- Or click the server switcher, choose **Add Server**, and paste a pairing link from `prokop pair` or **Settings → Devices → Pair a device**.

See [Security & Authentication](./auth.md#using-prokop-from-another-device) for LAN, Tailscale, VPN, and proxy setups.

## Several machines

Once two or more machines are saved, the workspace switcher lists the workspaces on every machine, grouped by machine name. Pick one to switch machines and open it in one step. Machines that are unreachable show their last known workspaces; machines this device is not paired with offer pairing.

A machine can be reached at several addresses (for example LAN at home and Tailscale away). After the first connection, the client learns them and switches automatically when the current one stops answering. An address that answers as a different machine is never used. If the same machine was added twice under different addresses, the entries are merged.

Inside another machine's app, pair a new machine with a pairing code: approval prompts only work when you open that machine's own address.

While you work on one machine, the client keeps listening to the others. When a session on another machine needs an approval or an answer, a prompt names the machine and session; **Open** switches to it. Finished runs on other machines get a short notice. The workspace switcher shows a dot when something is waiting elsewhere, and each machine's heading shows how many items wait there.

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
