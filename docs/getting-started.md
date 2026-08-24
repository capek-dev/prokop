# Getting Started

Install Prokopai, run one setup command, then add an LLM provider in the client.

## Prerequisites

- **macOS**, **Linux**, or **Windows**
- An LLM provider API key or supported OAuth account

## 1. Install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/capek-dev/prokop/main/install/install-prokopai.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/capek-dev/prokop/main/install/install-prokopai.ps1 | iex
```

The installer downloads the latest binary to `~/.prokopai/bin/prokopai` and adds it to your `PATH`.

## 2. Set up and open Prokopai

```bash
prokopai init
```

`init` performs the complete first-run setup:

1. Creates the standard files and directories under `~/.prokopai/`.
2. Creates and migrates the SQLite database.
3. Installs the bundled preconfigs.
4. Starts the Prokopai daemon on port **8742**.
5. Opens the built-in client in your browser.

The baseline tools used by the bundled agents are included in the binary. No tool installation or update command is required.

Advanced automation can override paths or skip individual setup operations:

```bash
prokopai init --db-path <path> --tools-path <path>
prokopai init --no-migrations
prokopai init --no-preconfigs
prokopai init --force
```

## 3. Connect an LLM provider

In the opened client, select **Configuration**, then use **Credentials** for an API key or **OAuth** for a supported subscription.

If you prefer environment configuration, edit `~/.prokopai/.env`, then run `prokopai restart`:

```bash
PROKOPAI_LLM_ANTHROPIC_API_KEY=sk-ant-...
PROKOPAI_LLM_OPENAI_API_KEY=sk-...
PROKOPAI_LLM_DEEPSEEK_API_KEY=sk-...
PROKOPAI_LLM_GOOGLE_API_KEY=...
```

## 4. Start a chat

1. Create a workspace by selecting a directory, or create a virtual workspace.
2. Pick a model.
3. Start chatting.

The built-in agents can read and edit files, search the workspace and web, run commands, manage tasks, request structured input, and manage worktrees without additional installation.

## Operational commands

These are available after setup, but are not part of installation:

```bash
prokopai status
prokopai logs
prokopai stop
prokopai start
prokopai restart
prokopai open
```

## Next steps

- [Set up more LLM providers](./configuration.md)
- [Learn about built-in and optional tools](./tools.md)
- [Understand workspaces and sessions](./workspaces.md)
- [Enable authentication](./auth.md)
