# Workspaces & Sessions

## Workspaces

A workspace is a directory the agent operates within. There are two types:

- **Physical workspace** - A real directory you choose on your machine. The agent can read and write files directly.
- **Virtual workspace** - An isolated empty directory auto-generated in `~/.prokopai/workspaces/<uuid>/`. Good for sandboxed experiments or when you don't want the agent touching real files.

### Creating a workspace

1. Open the client
2. Click **New Workspace** in the sidebar
3. Choose "Physical" and pick a directory, or "Virtual" for an isolated sandbox
4. Optionally add an `AGENTS.md` file in that directory for project-specific instructions

### Workspace instructions

Create an `AGENTS.md` file in the workspace root:

```markdown
# Project Rules
- This is a Next.js project
- Use the App Router, not Pages Router
- All components go in src/components/
```

The agent loads this automatically when you switch to the workspace.

### Global instructions

The file `~/.prokopai/AGENTS.md` contains instructions that apply to **all** workspaces. These are loaded first, then workspace-specific ones are appended.

### Permissions

Each workspace has its own permission state. When you approve a tool "always" in one workspace, it doesn't affect others.

## Workspace Capabilities

Capabilities are optional features you enable per workspace. All are off by default. Enable them through the client: **three dots (top right) > Workspace Settings > Capabilities**.

Each capability that lets the agent write files has a **permission risk level** controlling when the agent must ask before acting:

| Level | Behavior |
|-------|----------|
| **None** | Never asks. Runs automatically. |
| **Low** | Asks for low-risk operations. |
| **Medium** | Asks for medium-risk and below. |
| **High** | Asks for high-risk and below. |
| **Critical** | Asks before everything. Effectively always confirm. |

### Memory

Lets the agent persist facts, decisions, and preferences across sessions. Two files store this:

- **`.prokopai/USER.md`** - User preferences and communication expectations (limit: 1500 chars)
- **`.prokopai/MEMORY.md`** - Workspace facts, conventions, commands, non-obvious fixes (limit: 2500 chars)

The agent decides what's worth remembering and saves entries automatically. Both files are injected into the system prompt at the start of every session. Tell it "we use pnpm" once. Two weeks later, in a new session, it already knows.

To review or edit manually, open the files in `<workspace>/.prokopai/`.

### Skills

Lets the agent create, update, and patch its own `SKILL.md` files. Skills are reusable instruction sets stored at `.agents/skills/[name]/SKILL.md`. Each has a name, description, and markdown body.

The agent discovers skills by matching the task against the description. When a match is found, the skill's instructions are loaded. This is different from `AGENTS.md`, which is always loaded.

With agent-managed skills enabled, the agent notices patterns in your work and creates skill files encoding those workflows. Next time, it just does it. No prompt engineering. No configuration.

See [Concepts: Skills](#skills) below for the file format.

### Workflow

Enables the parallel workflow tool. The agent decomposes a complex task into independent subtasks, fans out concurrent subagents (max 5 at a time), and synthesizes the results into one answer.

This protects your context window. You see only the final synthesis, not all intermediate results. A full codebase audit that took minutes now takes seconds.

### Session Search

Lets the agent search past sessions in the current workspace. It can recall what was discussed, what was decided, and what tools were run. Three modes:

- **List** - Enumerate recent sessions with IDs and titles
- **Search** - Full-text search across all sessions in the workspace
- **Read** - Read messages surrounding a specific message (or the latest messages)

The `includeToolResults` setting controls whether tool output is included in search results.

## Skills

Skills are conditional instruction sets. Unlike `AGENTS.md` (always loaded), skills load only when the task matches their description.

### File format

```
<workspace>/.agents/skills/
  my-skill/
    SKILL.md
```

`SKILL.md` uses YAML frontmatter:

```markdown
---
name: code-review
description: Load when reviewing code for bugs, performance, or security issues
---

# Code Review Skill

## Procedure
1. Read the full diff before commenting
2. Check for edge cases in conditional logic
3. Verify error handling covers all catch blocks
4. Flag any hardcoded secrets or credentials
```

### Per-preconfig scoping

Preconfigs can limit which skills are available. Leave the skills field empty to use all skills, or pick specific ones.

## Sessions

A session is a single conversation thread within a workspace. Each session is an independent agent run with its own message history, model selection, and state.

### Starting a session

1. Select a workspace
2. Pick a **preconfig** (system prompt template), or start from scratch
3. Select a **model** and optionally a reasoning variant
4. Start chatting

### Session lifecycle

- **Active** - The agent is processing messages
- **Idle** - Waiting for your next message
- **Interrupted** - You cancelled the current generation

### Preconfigs

Preconfigs bundle everything that defines an agent's behavior: system prompt, tool set, default model, skills scoping, temperature, and subagent spawn rules.

Key properties:

| Field | Description |
|-------|-------------|
| **System Prompt** | Instructions that define the agent's role |
| **Tools** | Which tools this preconfig can use |
| **Model** | Default model (optional, inherits from session if unset) |
| **Temperature** | Creativity vs determinism (0.0 to 2.0) |
| **Skills** | Which skills to load (empty = all, or pick specific ones) |
| **Subagent rules** | Toggle whether this preconfig can spawn subagents, and which preconfigs it's allowed to spawn |

You can switch preconfigs **mid-session** without starting over. The conversation continues with the new behavior. A coder becomes a reviewer. A reviewer becomes a tester.

## Goal Mode

Goal mode turns a single message into an autonomous loop. Instead of doing one turn and stopping, the agent works until a completion condition is met.

### How it works

1. You switch the send mode from **Chat** to **Goal**
2. You define a completion condition (e.g., "all tests pass and lint is clean")
3. You set a maximum number of turns (default: 5)
4. The agent works a turn
5. A **separate evaluator** inspects real tool output: test results, lint output, file contents
6. If the condition is not met, the evaluator tells the agent what's still missing
7. The agent continues. Repeat until the condition is met or max turns is reached

The evaluator does **not** trust the agent saying "I'm done." It verifies from concrete evidence. The agent doesn't even know it's in a loop. It just receives continuation messages and keeps working.

### Cancellation

Press **Stop** at any time. The goal loop stops immediately. The goal state is marked as cancelled.

### Goal states

- **active** - The loop is running
- **met** - The evaluator confirmed the condition is satisfied
- **failed** - Max turns reached without meeting the condition
- **cancelled** - You stopped the loop

## Session Controls

### Fork

Branch a session at any message. Creates a new session with the same history up to that point, then diverges. Useful for exploring different approaches to a problem.

How it works:
1. Click the fork icon next to any message
2. A new session is created with the history up to that point
3. Continue the conversation in the new direction

### Revert

Undo to any previous point in a conversation. Later messages are discarded.

### Interrupt

Cancel a running generation. Interrupts cascade to subagents: if a subagent is running, interrupting the parent also interrupts the child.

### Compact

When a conversation approaches the model's context window limit, Prokop automatically compacts (summarizes) older messages while preserving recent context and tool results. This is transparent. You don't need to do anything. See [Configuration](./configuration.md#compaction) for tuning options.

### Queue

Send a message while the agent is still processing. The message is queued and delivered when the agent finishes its current step.

## Subagents

The agent can spawn subagents for complex, multi-step tasks. Subagents:

- Run in **isolated sessions** (separate message history)
- **Inherit** the parent's workspace context
- Are limited to **2 levels of depth** (subagent, then sub-subagent)
- Support **cascading interrupts** (interrupt parent, children stop too)
- Can be **resumed** later with full context (pass a `task_id`)
- Have **independent permissions** (a subagent can have different tool access than its parent)
- Can run **concurrently** (the agent can launch multiple at once)

Subagents are automatic. The agent decides when to spawn them based on the complexity of the task.

### Parallel Workflows

When the Workflow capability is enabled, the agent has access to the `workflow` tool. This is different from spawning individual subagents:

| | Subagents (`task`) | Workflows (`workflow`) |
|---|---|---|
| **Execution** | Sequential or concurrent, agent decides | Decompose, fan out (max 5 concurrent), synthesize |
| **Context** | You see each subagent's results | You see only the final synthesis |
| **Best for** | Focused delegations, dependent subtasks | Large parallel tasks, research, bulk operations |

The workflow tool automatically decomposes the task, runs subagents in parallel, and synthesizes results. This protects your context window from intermediate results.

## MCP Integration

MCP (Model Context Protocol) is an open standard for connecting AI tools to external services. Prokop connects to any MCP server, giving the agent access to third-party APIs, databases, and services.

### Configuration

MCP servers are configured per-workspace in `.prokopai/mcp.json`:

```json
{
  "servers": {
    "my-local-server": {
      "type": "local",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "..." }
    },
    "my-remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### Server types

- **Local (stdio)** - Spawns a child process. Configure with command, args, env vars, timeout.
- **Remote (HTTP/SSE)** - Connects over HTTP. Supports custom headers, OAuth, timeouts.

### OAuth

For remote servers requiring authentication, Prokop handles the full OAuth flow: opens a browser tab for login and approval, stores the token server-side. If client registration is needed first, Prokop handles that automatically.

### Status badges

Each MCP server shows a status badge in the client:

| Badge | Meaning |
|-------|---------|
| **Connected** | Server is running and tools are available |
| **Disabled** | Server is configured but disabled |
| **Failed** | Connection attempt failed |
| **Needs Auth** | OAuth authorization required |
| **Needs Registration** | OAuth client registration required |

MCP tools appear alongside built-in tools. The agent calls them identically. No adapters, no wrappers.

## Terminal Sessions

The client provides full PTY terminal sessions. The agent can also run commands in these terminals via the `shell` tool.

- **Multi-tab** - Run multiple terminals side by side
- **Persistent** - Terminals survive across chat sessions
- **Visualized** - Terminal output appears as rendered blocks in chat

## Data Storage

Sessions, messages, and permissions are stored in SQLite at `~/.prokopai/data/agent.db` (or your custom `PROKOPAI_DATABASE_PATH`). Workspace data (files, project structure) remains in the workspace directory.

Memory files live in `<workspace>/.prokopai/USER.md` and `<workspace>/.prokopai/MEMORY.md`. Skill files live in `<workspace>/.agents/skills/`. MCP configuration lives in `<workspace>/.prokopai/mcp.json`.
