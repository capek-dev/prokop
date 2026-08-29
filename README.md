<p align="center">
  <img src="docs/promo.webp" alt="Prokop web client - chat interface, workspace selector, and tool execution" width="800">
</p>

<p align="center">
  <strong>An always-on coding agent. On your machine.</strong>
</p>

<p align="center">
  One binary: the agent server and the web client, on your machine.<br>
  It runs as a daemon, you drive it from any browser, and it works on your code<br>
  with whatever model you bring. No account. No telemetry. Apache 2.0.
</p>

<p align="center">
  <a href="https://github.com/capek-dev/prokop/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/capek-dev/prokop?color=6366f1"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-6366f1"></a>
  <a href="https://bun.sh"><img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-6366f1?logo=bun"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-6366f1?logo=typescript"></a>
</p>

<p align="center">
  <a href="docs/getting-started.md">Get Started</a> ·
  <a href="docs/index.md">Docs</a> ·
  <a href="https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj">Chrome Extension</a>
</p>

---

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/capek-dev/prokop/main/install/install-prokopai.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/capek-dev/prokop/main/install/install-prokopai.ps1 | iex
```

**Set up and open Prokop:**
```bash
prokop init
```

`init` creates the standard configuration, prepares the database and bundled agents, starts the daemon, and opens the client at `http://localhost:8742`. The web client and all baseline coding tools are included in the binary. The client can be installed as a PWA on supported devices. See the [Getting Started guide](docs/getting-started.md).

---

## Features

The agent and its coding tools work out of the box. Everything else (memory, skills, session search, workflows) is opt-in, per workspace, in **workspace settings**.

| | |
|---|---|
| **Coding Tools, Built In** | Read, edit, write, and patch files. Search with grep and glob. Run shell commands. Track tasks. Manage Git worktrees. Ships in the binary, nothing to install. |
| **Web Client, Included** | The production web client ships with the server. Install once, open in any browser, add it as a PWA. |
| **Always On** | The server runs as a daemon. Close your laptop, open your phone, the session is still there. Push notifications when a run finishes or needs a permission. |
| **A Real Workspace UI** | Virtualized file tree with search, a diff for every edit, terminals over WebSocket, and tabs or a side-by-side board with up to 6 live sessions. |
| **Goal Mode** | Set a completion condition. A separate evaluator inspects real tool output every turn. It loops until the tests pass. |
| **Persistent Memory** | Tell it "we use pnpm" once. Two weeks later, in a new session, it already knows. Plain markdown files on disk. |
| **Self-Programming Skills** | The agent notices patterns and writes its own `SKILL.md` files. It programs itself. |
| **Session Search** | Full-text search over every past session, powered by SQLite FTS5. The agent checks its own history. |
| **Parallel Workflows** | Decompose a task, fan out up to 5 concurrent subagents, synthesize one answer. Only the result lands in your context window. |
| **Scheduled Tasks** | Cron jobs that run as agent sessions. Nightly dependency audit, weekly changelog. No human in the loop. |
| **Any Model** | Anthropic, OpenAI, Google, DeepSeek, OpenRouter, MiniMax, Zhipu. API keys, or subscription auth through Codex and Zhipu Coding Plan. |
| **MCP Integration** | Connect any MCP server, stdio or remote. OAuth handled server-side. Tools appear alongside built-in tools. |
| **Browser Automation** | Optional Chrome extension gives the agent real hands on Chrome: read, click, fill, navigate. Same interface as files and shell. |
| **Sandbox** | Simulate model responses end to end. Test agent flows without spending API credits. |
| **Open Source** | Apache 2.0. No telemetry, no account, no cloud. Prompts, memory, and skills are files on disk. |

---

## Why Prokop?

- **A server, not a terminal tab.** Most coding agents live in a terminal and die when it closes. Prokop runs as a daemon on your machine. Sessions survive closed laptops. Jobs run at 3am whether you're watching or not. You drive it from any browser, on any device.

- **One binary, everything included.** Server, production web client, and the built-in coding tools. One install command and `prokop init`, and you're working. No plugin store, no separate desktop app, no vendor account.

- **Bring your own brain.** Seven providers, API keys or subscription auth. Use your ChatGPT subscription through Codex, or your GLM Coding Plan. Switch models per session. If a better model ships tomorrow, you point Prokop at it.

- **Nothing hidden, nothing forced.** No baked-in system prompt you can't read, no memory you can't open. Capabilities are opt-in per workspace. Prompts, memory, and skills are plain files. Version them, share them, delete them.

- **An open engine underneath.** The runtime is Čapek: execution, providers, tools, memory, permissions, and workflows as composable packages (`@capekai/core`). Prokop is one host built on it. You could build your own.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      Client Layer                         │
│         Web client (in the binary) · PWA · Extension      │
│         WebSocket + REST, from any device                 │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────┴────────────────────────────────┐
│               Runtime (@capekai/core)                     │
│                                                           │
│   Plugin kernel · Agent loop · Provider registry          │
│   Tools · Permissions · Memory · Skills · Subagents       │
│   Workflows · Goals · Compaction · Sandbox · Scheduler    │
└──────────────────────────┬────────────────────────────────┘
                           │ composed by
┌──────────────────────────┴────────────────────────────────┐
│                Host (@prokopai/server)                    │
│                                                           │
│   HTTP + WebSocket · SQLite Store · Terminal Sharing      │
│   MCP Manager (stdio + OAuth) · Scheduled Jobs            │
│   Built-in Coding Tools · Worktrees · Auth and TLS        │
│                                                           │
│   ~/.prokopai/                    (data, agents, keys)    │
│   ~/.prokopai/agents/<name>/      (agent home: memory,    │
│                                     skills, sessions)     │
│   <workspace>/.prokopai/          (memory, mcp.json)      │
│   <workspace>/.agents/skills/     (SKILL.md files)        │
└───────────────────────────────────────────────────────────┘
                           │

      LLM Providers (Anthropic, OpenAI, Google, DeepSeek,
           OpenRouter, MiniMax, Zhipu)
```

---

## Documentation

Documentation lives in this repository: [docs/index.md](docs/index.md)

| | |
|---|---|
| [Getting Started](docs/getting-started.md) | Install, initialize, first session |
| [Workspaces & Sessions](docs/workspaces.md) | Capabilities, Goal Mode, MCP, Skills, Memory, Workflows |
| [Configuration](docs/configuration.md) | API keys, models, env vars, MCP config |
| [Tools](docs/tools.md) | Installed tools, capability tools, writing your own |
| [Security & Auth](docs/auth.md) | Auth tokens, TLS, permissions |

---

## License

[Apache 2.0](LICENSE)

## Legacy Compatibility

Prokop still accepts legacy `JEAN2_*` environment variables and falls back to `~/.jean2` data and workspace paths when the canonical `PROKOPAI_*` variables or `~/.prokopai` paths are absent. New setups should use the Prokop names. Run `prokop migrate-legacy-data` to move an existing `~/.jean2` setup to `~/.prokopai`, rewrite legacy environment keys and paths, rename nested agent home directories, and update stored workspace paths. `prokop migrate` only runs database schema migrations.
