# Getting Started

Jean2 runs as a background daemon on your machine. Install it, initialize it, add an API key, and start chatting.

## Prerequisites

- **macOS**, **Linux**, or **Windows**
- A valid API key for at least one LLM provider (e.g., [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), [DeepSeek](https://platform.deepseek.com/))

## 1. Install

**macOS / Linux:**

```bash
curl -fsSL https://jean2.ai/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://jean2.ai/install.ps1 | iex
```

This downloads the latest Jean2 binary and places it at `~/.jean2/bin/jean2`.

> For development from source, see [Contributing](../README.md#contributing).

## 2. Initialize

```bash
jean2 init
```

This walks you through an interactive setup:

| Prompt | Default | What it does |
|--------|---------|--------------|
| Database path | `~/.jean2/data/agent.db` | Where sessions and messages are stored (SQLite) |
| Tools path | `~/.jean2/tools/` | Where tool modules live |
| Run migrations? | Yes | Creates the database schema |
| Install preconfigs? | Yes | Installs default system prompts and agent configurations |
| Install tools? | Yes | Installs a curated set of recommended tools |

**What `init` creates:**

```
~/.jean2/
├── .env                  # API keys and environment variables
├── AGENTS.md             # Global agent instructions (applied to all projects)
├── config.json           # Server configuration
├── models.json           # Built-in model registry
├── data/agent.db         # SQLite database
├── tools/                # Tool modules
├── prompts/              # User prompts directory
├── preconfigs/           # System prompts and agent configurations
├── workspaces/           # Per-project workspace data
└── providers/            # Provider-specific overrides
```

**Non-interactive usage:**

```bash
jean2 init --install-tools        # Skip prompts, install everything
jean2 init --no-tools             # Skip tool installation
jean2 init --no-preconfigs        # Skip preconfig installation
jean2 init --force                # Re-initialize (overwrites config)
```

## 3. Add an API Key

You can set API keys directly in the client while the server is running: no need to edit config files manually.

1. Open the client (`http://localhost:8742`)
2. Click the **three dots (top right) → Configuration → Credentials** to set API keys, or **OAuth** to connect your ChatGPT subscription plan

If you prefer to set them in a file, edit `~/.jean2/.env`:

```bash
JEAN2_LLM_ANTHROPIC_API_KEY=sk-ant-...
JEAN2_LLM_OPENAI_API_KEY=sk-...
JEAN2_LLM_DEEPSEEK_API_KEY=sk-...
JEAN2_LLM_GOOGLE_API_KEY=...
```

Then restart: `jean2 restart`

All configuration and API keys live in `~/.jean2/.env`. System environment variables take precedence over this file.

## 4. Start the Server

```bash
jean2 start
```

This starts the server as a background daemon on port **8742** by default.

```bash
# Check if it's running
jean2 status

# See what's happening
jean2 logs

# Stop it
jean2 stop

# Restart it
jean2 restart
```

## 5. Connect a Client

### Built-in client (automatic)

When you run `jean2 start`, the server serves the client embedded in its binary on port **8742**. Just open your browser:

```
http://localhost:8742
```

If the client is already running:

```bash
jean2 open
```

### Desktop app (macOS)

Download the latest Electron app from [GitHub Releases](https://github.com/jean2ai/jean2/releases).

### PWA (any device with a browser)

The client is a Progressive Web App. Open it in your browser, tap "Add to Home Screen" on mobile, or "Install" on desktop. Works offline after the first visit.

## 6. Start a Chat

1. Open the client
2. Create a **workspace**: pick a directory on your machine the agent can access, or create a **virtual workspace** (an isolated directory auto-generated in `~/.jean2/workspaces/`)
3. Pick a **model** from the dropdown
4. Start chatting

The agent can read files, edit code, run shell commands, search the web, and more, depending on which tools you have installed and which permissions you grant.

For advanced features, enable **workspace capabilities** (memory, skills, workflow, session search) from **Workspace Settings > Capabilities**. See [Workspaces & Sessions](./workspaces.md#workspace-capabilities) for details.

## Next Steps

- [Set up more LLM providers](./configuration.md)
- [Learn about available tools](./tools.md)
- [Understand workspaces, sessions, and capabilities](./workspaces.md)
- [Enable authentication](./auth.md)
