<p align="center">
  <img src="docs/promo_v1.1.0.webp" alt="Jean2 desktop client - chat interface, workspace selector, and tool execution" width="800">
</p>

<p align="center">
  <strong>No baked-in behavior. You build the rest.</strong>
</p>

<p align="center">
  Jean is the server. Everything else (the LLM, the tools, the browser, the personality)<br>
  is something you connect <strong>to</strong> it. No default system prompt, no default tools,<br>
  no fixed personality. You opt in to each layer. Memory, skills, workflows, agents. Your call.
</p>

<p align="center">
  <a href="https://github.com/jean2ai/jean2/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/jean2ai/jean2?color=6366f1"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-6366f1"></a>
  <a href="https://bun.sh"><img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-6366f1?logo=bun"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-6366f1?logo=typescript"></a>
  <a href="https://discord.com/invite/38sUKnUNPQ"><img alt="Discord" src="https://img.shields.io/badge/Discord-join-6366f1?logo=discord"></a>
</p>

<p align="center">
  <a href="https://jean2.ai/docs/get-started/installation">Get Started</a> ·
  <a href="https://jean2.ai/docs">Docs</a> ·
  <a href="https://jean2.ai">Website</a> ·
  <a href="https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj">Chrome Extension</a> ·
  <a href="https://discord.com/invite/38sUKnUNPQ">Discord</a>
</p>

---

## Install

**macOS / Linux:**
```bash
curl -fsSL https://jean2.ai/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://jean2.ai/install.ps1 | iex
```

**Run:**
```bash
prokopai init
jean2 start
jean2 open
```

The server serves the client at `http://localhost:3774`. Desktop app (macOS Electron) and PWA (any device) also available. See the [Getting Started guide](https://jean2.ai/docs/get-started/installation).

---

## Features

By default, Jean2 is as bare as Codex or OpenCode. A blank prompt. No memory. No skills. No session search. You opt in to each layer in **workspace settings**.

| | |
|---|---|
| **Agents** | A preconfig that comes alive. Own home directory, own memory, own skills. Access to sessions across every workspace it's ever worked in. Persistent identity that carries context from task to task. |
| **Goal Mode** | Set a completion condition. A separate evaluator inspects real tool output every turn. It loops until tests pass. |
| **Persistent Memory** | Tell it "we use pnpm" once. Two weeks later, in a new session, it already knows. Two scopes: workspace (shared context) and agent (identity). |
| **Self-Programming Skills** | The agent notices patterns and writes its own `SKILL.md` files. It programs itself. Same two scopes as memory. |
| **Session Search** | Full-text search over all past sessions, powered by SQLite FTS5. The agent searches its own history. Two scopes: workspace and agent. |
| **Parallel Workflows** | Decompose, fan out 5 concurrent subagents, synthesize one answer. Only the final result lands in the main context window. |
| **Scheduled Tasks** | Cron jobs that run as agent sessions. Daily code review, nightly dependency check, weekly changelog. No human in the loop. |
| **Structured Responses** | Define a JSON schema, apply it to the next message. A yes/no question produces a yes/no answer. |
| **Browser Automation** | Jean2Browser gives the agent real hands on Chrome: read, click, fill, navigate. Same interface as files and shell. |
| **Bring Your Own Model** | OpenAI, DeepSeek, OpenRouter, MiniMax, Zhipu. Use API keys or your ChatGPT subscription via Codex. |
| **MCP Integration** | Connect any MCP server. Full OAuth handled server-side. Tools appear alongside built-in tools. |
| **Server-First** | Persistent 24/7 server. PWA on any device. Close your laptop. Open your phone. The agent never stops. |
| **Open Source** | Apache 2.0. No telemetry. No lock-in. Prompts, tools, skills, and memory are files on disk. |

---

## Why Jean2?

Jean connects **to** things. The browser. Your codebase. Any LLM. Jean2 is the hub.
Everything else is a surface you choose to connect.

- **No baked-in behavior.** Every AI coding agent ships with hidden system prompts you can't change. Claude Code has a long system prompt buried in the npm package. Cursor has behavior rules that override your preferences. Jean2 ships with none of that. The system prompt is composed from files you control. Every layer is visible and replaceable.

- **Everything is opt-in.** By default, Jean2 is a blank slate. You build the agent you want, layer by layer. Turn on memory. Turn on skills. Turn on session search. Or don't. Your call.

- **You bring the keys, you keep the data.** Runs on your machine. No telemetry, no vendor lock-in, no subscription to a single AI company.

- **Files on disk.** System prompts, tools, skills, and memory are all files. Version control them, share them, delete them. No vector database, no embedding pipeline, no hidden layers.

- **An agent that evolves.** Not through fine-tuning. Through taking notes. Memory, skills, and session search accumulate over time. Your agent on day 30 is smarter than your agent on day 1. The model didn't change. The files got richer.

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                      Client Layer                         │
│   Desktop (Electron) · Web/PWA · Browser Extension        │
│              WebSocket + REST (any network)               │
└──────────────────────────┬────────────────────────────────┘
                           │
┌──────────────────────────┴────────────────────────────────┐
│                   Server (@jean2/server)                  │
│                                                           │
│   Agent Loop (AI SDK v6) · Tool Executor                  │
│   Goal Loop + Evaluator · Workflow Orchestrator           │
│   MCP Manager (stdio + OAuth) · Subagent Orchestrator     │
│   Memory · Skills Registry · Session Search (FTS)         │
│   Scheduled Tasks · Structured Responses                  │
│   Ask Protocol (Permissions, Questions, Forms)            │
│   SQLite Store · Compaction Engine                        │
│                                                           │
│   ~/.prokopai/                    (data, tools, preconfigs)   │
│   ~/.prokopai/agents/<name>/      (agent home: memory,        │
│                                 skills, sessions)          │
│   <workspace>/.jean2/          (memory, mcp.json)          │
│   <workspace>/.agents/skills/  (SKILL.md files)            │
└───────────────────────────────────────────────────────────┘
                           │
              LLM Providers (OpenAI, DeepSeek, OpenRouter,
                MiniMax, Zhipu)
```

---

## Documentation

Full documentation site: [jean2.ai/docs](https://jean2.ai/docs/get-started/installation)

| | |
|---|---|
| [Getting Started](https://jean2.ai/docs/get-started/installation) | Install, initialize, first session |
| [Workspaces & Sessions](https://jean2.ai/docs/workspaces/overview) | Capabilities, Goal Mode, MCP, Skills, Memory, Workflows |
| [Configuration](https://jean2.ai/docs/configuration/overview) | API keys, models, env vars, MCP config |
| [Tools](https://jean2.ai/docs/reference/writing-tools) | Installed tools, capability tools, writing your own |
| [Security & Auth](https://jean2.ai/docs/guides/auth) | Auth tokens, TLS, permissions |

---

## Community

[Join the Discord](https://discord.com/invite/38sUKnUNPQ) to follow development, share what you're building, or ask for help.

---

## License

[Apache 2.0](LICENSE)
