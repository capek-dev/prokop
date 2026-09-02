# Tools

Tools give the agent the ability to interact with your filesystem, run commands, search the web, and more. The baseline tools used by bundled agents ship inside the server binary and need no installation or updates. Optional integrations can be added separately.

## Built-in tools

A fresh `prokop init` can use the filesystem, shell, web fetch, task, question, and worktree tools immediately. Built-in tools take precedence over optional extensions with the same name.

### File Tools

| Tool | Description |
|------|-------------|
| **read-file** | Read files or list directory contents |
| **write-file** | Create or overwrite files |
| **edit** | String replacements in existing files with fuzzy matching |
| **multiedit** | Multiple string replacements applied atomically |
| **apply-patch** | Apply unified diff patches to files |
| **glob** | Find files matching glob patterns |
| **grep** | Search file contents with regex |
| **ls** | List directory contents with tree formatting |

### Shell

| Tool | Description |
|------|-------------|
| **shell** | Execute shell commands in persistent sessions |

The shell tool enforces safety: dangerous commands (`rm`, `sudo`, `curl`), filesystem modifications, and operations outside the workspace require explicit permission.

### Web

| Tool | Description |
|------|-------------|
| **webfetch** | Fetch and convert web pages to readable text |
| **file-to-markdown** | Convert files (PDF, Office, LibreOffice, ZIP) to Markdown |

### Browser

Requires the **ProkopaiBrowser** extension. Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj), then connect it to your Prokop server:

| Tool | Description |
|------|-------------|
| **browser-navigate** | Navigate the browser to a URL |
| **browser-read-active-tab** | Read the current tab's title, URL, and visible text |
| **browser-tab-manage** | List, create, close, and switch between browser tabs |
| **browser-discover-elements** | Find interactive elements on a page |
| **browser-dom-action** | Click, type, and interact with page elements |
| **browser-screenshot** | Capture screenshots of the active tab |

### Interaction

| Tool | Description |
|------|-------------|
| **question** | Ask the user structured questions (select, multi-select, text, confirm) |
| **todoread** | Read the current task list |
| **todowrite** | Update the task list |

### Tavily Search

Requires a Tavily API key:

| Tool | Description |
|------|-------------|
| **tavily-search** | Web search with topic and time filters |
| **tavily-crawl** | Deep crawl a URL and its subpages |
| **tavily-extract** | Extract clean content from URLs |
| **tavily-map** | Map/discover URLs from a domain |

## Capability Tools

These tools are built into the server and appear only when their corresponding workspace capability is enabled. They are not installed via `prokop tools install`.

| Tool | Capability | Description |
|------|------------|-------------|
| **memory** | Memory | Save and manage persistent facts across sessions in `.prokopai/USER.md` and `.prokopai/MEMORY.md` |
| **session_search** | Session Search | Search past sessions by text, list recent sessions, or read context around a specific message |
| **workflow** | Workflow | Decompose a task into parallel subtasks, fan out concurrent subagents (max 5), and synthesize results |
| **skill_manage** | Skills | Create, update, patch, and delete SKILL.md files. Lets the agent program its own workflows |
| **skill** | (always available) | Load a specific skill's instructions on demand |

See [Workspaces & Sessions](./workspaces.md#workspace-capabilities) for how to enable capabilities.

## MCP Tools

When you connect an MCP server to a workspace, its tools appear alongside built-in and installed tools. The agent calls them identically. No adapters, no wrappers.

MCP tools are configured per-workspace in `<workspace>/.prokopai/mcp.json`. See [Configuration](./configuration.md#mcp-configuration) for the config format.

## Optional tool extensions

External tools are only needed for integrations not included in the binary, such as Tavily, browser automation, or document conversion. The registry is intentionally small; other integrations can be maintained and distributed by the community through compatible repositories.

```bash
# Browse optional extensions
prokop tools list

# Install a specific optional integration
prokop tools install tavily-search

# Update optional installed extensions
prokop tools update
```

These commands are not part of first-run setup. Do not install built-in tool names from the external registry.

```bash
# List only installed extensions
prokop tools list --installed

# Check optional extensions for updates
prokop tools outdated

# Remove an optional extension
prokop tools remove tavily-search
```

Optional extensions are stored in `~/.prokopai/tools/` (or your custom `PROKOPAI_TOOLS_PATH`). Built-in tools remain in the binary.

## The Ask Protocol

Every tool gets a `ToolContext` with an `ask()` method. This is how tools request permissions, ask questions, or get user input. The client handles the UI. The tool just awaits a typed response.

### Permission asks

Tool calls that modify files, run commands, or access the network go through the permission system. The user can:

- **Approve once**: Allow this specific call
- **Approve always**: Auto-approve future calls with the same parameters
- **Deny**: Block this call

The permission state persists per workspace and per tool.

### Question asks

Tools can ask the user structured questions through `ctx.ask()`:

```typescript
const answer = await ctx.ask({
  type: 'question',
  question: {
    type: 'single_select',
    question: 'Which file should I use?',
    options: [
      { label: 'config.ts', value: 'config' },
      { label: 'settings.ts', value: 'settings' },
    ],
  },
});
```

The client renders the appropriate form (radio buttons, checkboxes, text input, etc.) and returns the answer.

## Writing a Custom Tool

A tool is a directory with two files:

```
my-tool/
├── tool.ts          # Tool definition + execute function
├── package.json     # Dependencies (can be empty for simple tools)
└── VERSION          # Semantic version (e.g., "1.0.0")
```

### `tool.ts`

```typescript
import type { ToolDefinition, ToolContext, ToolResult } from '@capekai/tool';

interface Input {
  message: string;
}

export const definition: ToolDefinition = {
  name: 'my-tool',
  description: 'Does something useful.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'A message to process',
      },
    },
    required: ['message'],
  },
};

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    // Do work here. ctx has:
    //   ctx.fs    = filesystem access (scoped to workspace)
    //   ctx.ask() = permission and question requests
    //   ctx.env   = safe environment variables

    const result = `Processed: ${input.message}`;
    return { success: true, result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
```

### `package.json`

```json
{
  "name": "my-tool",
  "version": "1.0.0",
  "dependencies": {
    "@capekai/tool": "^1.0.0"
  }
}
```

### Installing custom tools

Place the tool directory in `~/.prokopai/tools/` and restart the server. Tools are discovered automatically by scanning for `tool.ts` files.

### Testing tools

Tools can be tested with the virtual filesystem test utilities used by the built-in tools. See `tools/test-utils.ts` for `VirtualFS`, `createMockContext`, and `WORKSPACE`.
