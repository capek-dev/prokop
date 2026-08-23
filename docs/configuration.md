# Configuration

All Jean2 configuration lives in `~/.jean2/`. API keys in `.env`, models in `models.json`, and server settings in `config.json`.

## Environment Variables

### LLM API Keys

Set these in `~/.jean2/.env`:

| Variable | Provider |
|----------|----------|
| `JEAN2_LLM_ANTHROPIC_API_KEY` | Anthropic (Claude) |
| `JEAN2_LLM_OPENAI_API_KEY` | OpenAI (GPT, Codex) |
| `JEAN2_LLM_DEEPSEEK_API_KEY` | DeepSeek |
| `JEAN2_LLM_GOOGLE_API_KEY` | Google (Gemini) |
| `JEAN2_LLM_OPENROUTER_API_KEY` | OpenRouter (multi-provider gateway) |
| `JEAN2_LLM_MINIMAX_API_KEY` | MiniMax |
| `JEAN2_LLM_ZHIPU_API_KEY` | Zhipu (GLM models) |
| `JEAN2_LLM_ZHIPU_CODING_API_KEY` | Zhipu Coding Plan |

### LLM Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `JEAN2_LLM_BASE_URL` | (provider default) | Override the API base URL for any provider |
| `JEAN2_LLM_TEMPERATURE` | `0.7` | Model temperature (0.0 – 2.0) |
| `JEAN2_LLM_MAX_TOKENS` | `32000` | Maximum output tokens per response |
| `JEAN2_LLM_MAX_STEPS` | `10` | Maximum agent steps per session (tool calls + responses) |
| `JEAN2_LLM_SUBAGENT_MAX_STEPS` | `50` | Maximum steps for subagents (trades off cost vs completeness) |

### Compaction

When conversations grow too large for the context window, Jean2 automatically compacts (summarizes) older messages. These settings control that behavior:

| Variable | Default | Description |
|----------|---------|-------------|
| `JEAN2_COMPACTION_MODEL` | (session model) | Model to use for compaction summaries |
| `JEAN2_COMPACTION_PROVIDER` | (session provider) | Provider for the compaction model |
| `JEAN2_COMPACTION_MAX_TOKENS` | `8000` | Maximum tokens for the compaction summary |
| `JEAN2_COMPACTION_AUTO_THRESHOLD_RATIO` | `0.75` | Trigger compaction when context reaches this fraction of the window |
| `JEAN2_COMPACTION_AUTO_RESERVE_CAP_TOKENS` | `32000` | Reserve this many tokens for the most recent messages |
| `JEAN2_COMPACTION_AUTO_SAFETY_MARGIN_TOKENS` | `20000` | Extra safety margin below the context limit |
| `JEAN2_COMPACTION_PRESERVE_RECENT_TOOL_COUNT` | `3` | Always keep this many recent tool call/result pairs |
| `JEAN2_COMPACTION_PRESERVE_SMALL_TOOL_CHARS` | `200` | Always keep tool results shorter than this (characters) |
| `JEAN2_COMPACTION_TOOL_CLEAR_CHARS_THRESHOLD` | `1000` | Clear tool results larger than this (characters) |
| `JEAN2_COMPACTION_MAX_PRUNED_TOOL_COUNT` | `50` | Maximum number of tool results to prune |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `JEAN2_PORT` | `8742` | Server port |
| `JEAN2_HOST` | `0.0.0.0` | Bind address |
| `JEAN2_DATA_DIR` | `~/.jean2` | Root data directory |
| `JEAN2_DATABASE_PATH` | `~/.jean2/data/agent.db` | SQLite database path |
| `JEAN2_TOOLS_PATH` | `~/.jean2/tools` | Tool modules directory |
| `JEAN2_PRECONFIGS_PATH` | `~/.jean2/preconfigs` | Preconfigs directory |
| `JEAN2_MODELS_PATH` | (none) | Custom models.json path |
| `JEAN2_CLIENT_ENABLED` | `true` | Set to `false` to disable the client embedded in the server binary |

### TLS (HTTPS)

| Variable | Default | Description |
|----------|---------|-------------|
| `JEAN2_TLS_ENABLED` | `false` | Enable HTTPS |
| `JEAN2_TLS_CERT_FILE` | (none) | Path to TLS certificate |
| `JEAN2_TLS_KEY_FILE` | (none) | Path to TLS private key |

### Auth

| Variable | Default | Description |
|----------|---------|-------------|
| `JEAN2_AUTH_TOKEN` | (none) | When set, enables authentication. See [Security & Auth](./auth.md). |

## Models

Models are defined in `~/.jean2/models.json`. Jean2 ships with a built-in registry of providers and models that gets written during `jean2 init`.

### Sync upstream models

New models are published to the upstream registry. Sync them:

```bash
# Merge new models into your local registry (keeps custom models)
jean2 models sync

# Replace your local registry with upstream
jean2 models sync --override
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

MCP servers are configured per-workspace in `<workspace>/.jean2/mcp.json`:

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

Preconfigs are stored in `~/.jean2/preconfigs/`. Each preconfig is a JSON file defining a system prompt, tool set, model, and behavior profile. Create and edit them through the client (**Configuration > Preconfigs**) or by editing the files directly.

Preconfigs can be switched mid-session without starting a new conversation. See [Workspaces & Sessions](./workspaces.md#preconfigs) for the full field reference.

## System Instructions

### Global instructions (`~/.jean2/AGENTS.md`)

Instructions that apply to **all** workspaces on this machine. Written during `jean2 init`. Edit it to add global rules:

```markdown
# Jean2 Global Instructions
- Always use TypeScript strict mode
- Never commit .env files
```

### Workspace instructions (`<workspace>/AGENTS.md`)

Instructions specific to a single project. Create an `AGENTS.md` file in the workspace root directory. The agent loads it automatically when that workspace is active.

### Memory files

When the Memory capability is enabled, two additional instruction files are auto-injected into the system prompt:

- **`<workspace>/.jean2/USER.md`** - User preferences and communication expectations
- **`<workspace>/.jean2/MEMORY.md`** - Workspace facts, conventions, non-obvious fixes

These persist across sessions. The agent manages them through the `memory` tool.
