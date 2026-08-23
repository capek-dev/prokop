# Configuration

All Prokop configuration lives in `~/.prokopai/`. API keys in `.env`, models in `models.json`, and server settings in `config.json`.

## Environment Variables

### LLM API Keys

Set these in `~/.prokopai/.env`:

| Variable | Provider |
|----------|----------|
| `PROKOPAI_LLM_ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `PROKOPAI_LLM_OPENAI_API_KEY` | OpenAI (GPT, Codex) |
| `PROKOPAI_LLM_DEEPSEEK_API_KEY` | DeepSeek |
| `PROKOPAI_LLM_GOOGLE_API_KEY` | Google (Gemini) |
| `PROKOPAI_LLM_OPENROUTER_API_KEY` | OpenRouter (multi-provider gateway) |
| `PROKOPAI_LLM_MINIMAX_API_KEY` | MiniMax |
| `PROKOPAI_LLM_ZHIPU_API_KEY` | Zhipu (GLM models) |
| `PROKOPAI_LLM_ZHIPU_CODING_API_KEY` | Zhipu Coding Plan |

### LLM Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `PROKOPAI_LLM_BASE_URL` | (provider default) | Override the API base URL for any provider |
| `PROKOPAI_LLM_TEMPERATURE` | `0.7` | Model temperature (0.0 – 2.0) |
| `PROKOPAI_LLM_MAX_TOKENS` | `32000` | Maximum output tokens per response |
| `PROKOPAI_LLM_MAX_STEPS` | `10` | Maximum agent steps per session (tool calls + responses) |
| `PROKOPAI_LLM_SUBAGENT_MAX_STEPS` | `50` | Maximum steps for subagents (trades off cost vs completeness) |

### Compaction

When conversations grow too large for the context window, Prokop automatically compacts (summarizes) older messages. These settings control that behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROKOPAI_COMPACTION_MODEL` | (session model) | Model to use for compaction summaries |
| `PROKOPAI_COMPACTION_PROVIDER` | (session provider) | Provider for the compaction model |
| `PROKOPAI_COMPACTION_MAX_TOKENS` | `8000` | Maximum tokens for the compaction summary |
| `PROKOPAI_COMPACTION_AUTO_THRESHOLD_RATIO` | `0.75` | Trigger compaction when context reaches this fraction of the window |
| `PROKOPAI_COMPACTION_AUTO_RESERVE_CAP_TOKENS` | `32000` | Reserve this many tokens for the most recent messages |
| `PROKOPAI_COMPACTION_AUTO_SAFETY_MARGIN_TOKENS` | `20000` | Extra safety margin below the context limit |
| `PROKOPAI_COMPACTION_PRESERVE_RECENT_TOOL_COUNT` | `3` | Always keep this many recent tool call/result pairs |
| `PROKOPAI_COMPACTION_PRESERVE_SMALL_TOOL_CHARS` | `200` | Always keep tool results shorter than this (characters) |
| `PROKOPAI_COMPACTION_TOOL_CLEAR_CHARS_THRESHOLD` | `1000` | Clear tool results larger than this (characters) |
| `PROKOPAI_COMPACTION_MAX_PRUNED_TOOL_COUNT` | `50` | Maximum number of tool results to prune |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PROKOPAI_PORT` | `8742` | Server port |
| `PROKOPAI_HOST` | `0.0.0.0` | Bind address |
| `PROKOPAI_DATA_DIR` | `~/.prokopai` | Root data directory |
| `PROKOPAI_DATABASE_PATH` | `~/.prokopai/data/agent.db` | SQLite database path |
| `PROKOPAI_TOOLS_PATH` | `~/.prokopai/tools` | Tool modules directory |
| `PROKOPAI_PRECONFIGS_PATH` | `~/.prokopai/preconfigs` | Preconfigs directory |
| `PROKOPAI_MODELS_PATH` | (none) | Custom models.json path |
| `PROKOPAI_CLIENT_ENABLED` | `true` | Set to `false` to disable the client embedded in the server binary |

### TLS (HTTPS)

| Variable | Default | Description |
|----------|---------|-------------|
| `PROKOPAI_TLS_ENABLED` | `false` | Enable HTTPS |
| `PROKOPAI_TLS_CERT_FILE` | (none) | Path to TLS certificate |
| `PROKOPAI_TLS_KEY_FILE` | (none) | Path to TLS private key |
| `PROKOPAI_LOCAL_HTTP` | follows TLS | When TLS is enabled, keep serving plain HTTP on the main port bound to loopback for local clients. Set to `false` for a TLS-only server |
| `PROKOPAI_LOCAL_HOST` | `127.0.0.1` | Bind address for the local plain HTTP listener (loopback only) |
| `PROKOPAI_TLS_PORT` | auto | Port for the TLS listener: same as `PROKOPAI_PORT` when bound to a specific non-loopback address (e.g. a Tailscale IP), otherwise `PROKOPAI_PORT + 1` |

### Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `PROKOPAI_AUTH_TOKEN` | (none) | When set, enables authentication. See [Security & Auth](./auth.md). |

## Models

Models are defined in `~/.prokopai/models.json`. Prokop ships with a built-in registry of providers and models that gets written during `prokopai init`.

### Sync upstream models

New models are published to the upstream registry. Sync them:

```bash
# Merge new models into your local registry (keeps custom models)
prokopai models sync

# Replace your local registry with upstream
prokopai models sync --override
```

### Built-in providers

| Provider ID | Name | Models |
|-------------|------|--------|
| `deepseek` | DeepSeek | V4 Pro, V4 Flash |
| `minimax` | MiniMax | M2.7, M2.5 |
| `zhipu-coding` | Z.AI (Coding Plan) | GLM-5.1, GLM-5 Turbo, GLM-5, GLM-4.7, GLM-4.7 Flash |
| `codex` | Codex (ChatGPT) | GPT-5.5, GPT-5.4, GPT-5.4 Mini, GPT-5.3 Codex, GPT-5.2 |

For providers not in the built-in list (Anthropic, OpenAI, Google, OpenRouter), you can add models interactively through the client (Configuration → Models) or by editing `models.json` directly.

### Model tiers

Models are categorized into tiers:

- **premium**: Best quality, highest cost. Use for complex tasks.
- **budget**: Good quality, lower cost. Use for routine tasks.

### Reasoning variants

Some models support reasoning effort variants (`low`, `medium`, `high`, `xhigh`, `max`) that control how much time the model spends "thinking" before responding. Select them from the model variant dropdown in the client.

## Workspace Capabilities

Capabilities are optional features enabled per workspace. All off by default. Configure through the client (**Workspace Settings > Capabilities**) or by updating workspace settings via the REST API.

| Capability | Settings Key | Purpose |
|---|---|---|
| **Memory** | `memory` | Persist facts and preferences across sessions |
| **Skills** | `skills` | Let the agent create and manage its own SKILL.md files |
| **Workflow** | `workflow` | Enable parallel multi-agent task decomposition |
| **Session Search** | `sessionSearch` | Let the agent search past sessions in the workspace |

### Settings format

Each capability with write access has a `permissionRisk` field (the risk level at which the agent must ask before acting):

```json
{
  "memory": { "enabled": true, "permissionRisk": "medium" },
  "skills": { "managementEnabled": true, "permissionRisk": "medium" },
  "workflow": { "enabled": true },
  "sessionSearch": {
    "enabled": true,
    "permissionRisk": "none",
    "includeToolResults": false
  }
}
```

Valid risk levels: `none`, `low`, `medium`, `high`, `critical`. See [Workspaces & Sessions](./workspaces.md#workspace-capabilities) for what each capability does.

## MCP Configuration

MCP servers are configured per-workspace in `<workspace>/.prokopai/mcp.json`:

```json
{
  "servers": {
    "server-name": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": {},
      "timeout": 30000
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": {}
    }
  }
}
```

Set `"enabled": false` on any server to disable it without removing the config.

## Preconfigs

Preconfigs are stored in `~/.prokopai/preconfigs/`. Each preconfig is a JSON file defining a system prompt, tool set, model, and behavior profile. Create and edit them through the client (**Configuration > Preconfigs**) or by editing the files directly.

Preconfigs can be switched mid-session without starting a new conversation. See [Workspaces & Sessions](./workspaces.md#preconfigs) for the full field reference.

## System Instructions

### Global instructions (`~/.prokopai/AGENTS.md`)

Instructions that apply to **all** workspaces on this machine. Written during `prokopai init`. Edit it to add global rules:

```markdown
# Prokop Global Instructions
- Always use TypeScript strict mode
- Never commit .env files
```

### Workspace instructions (`<workspace>/AGENTS.md`)

Instructions specific to a single project. Create an `AGENTS.md` file in the workspace root directory. The agent loads it automatically when that workspace is active.

### Memory files

When the Memory capability is enabled, two additional instruction files are auto-injected into the system prompt:

- **`<workspace>/.prokopai/USER.md`** - User preferences and communication expectations
- **`<workspace>/.prokopai/MEMORY.md`** - Workspace facts, conventions, non-obvious fixes

These persist across sessions. The agent manages them through the `memory` tool.
