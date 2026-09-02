# Tools

Tools give the agent the ability to interact with your filesystem, run commands, search the web, and more. Built-in tools ship inside the server binary and need no installation or updates. Bundled agent preconfigs enable a focused subset, and custom preconfigs can enable other built-ins.

## Built-in tools

A fresh `prokop init` can use the filesystem, shell, web fetch, web search, task, question, and worktree tools immediately. Built-in tools take precedence over optional extensions with the same name.

### File Tools

| Tool | Description |
|------|-------------|
| **read-file** | Read files or list directory contents |
| **file-to-markdown** | Convert files (PDF, Office, LibreOffice, ZIP) to Markdown |
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
| **tavily-search** | Search the web with topic, date, and domain filters (requires `TAVILY_API_KEY`) |

Configure your own Tavily API key in Settings before using `tavily-search`. The server does not provide an API key.

### Browser

Browser tools are built into the server but are not enabled by the bundled `prokop-code` or `explore` preconfigs. Add the tools you need to a custom preconfig. They require the **ProkopaiBrowser** extension, installed from the [Chrome Web Store](https://chromewebstore.google.com/detail/jean2browser/jpahdfmmfmmnacapmkchljmcijoedcpj) and connected to your Prokop server.

| Tool | Description |
|------|-------------|
| **browser_navigate** | Navigate the browser to a URL |
| **browser_read_active_tab** | Read a tab's title, URL, and visible text |
| **browser_tab_manage** | List, create, close, and switch between browser tabs |
| **browser_discover_elements** | Find interactive elements on a page |
| **browser_dom_action** | Click, type, and interact with page elements |
| **browser_screenshot** | Capture screenshots of a browser tab |

### Interaction

| Tool | Description |
|------|-------------|
| **question** | Ask the user structured questions (select, multi-select, text, confirm) |
| **todoread** | Read the current task list |
| **todowrite** | Update the task list |

## Capability Tools

These tools are built into the server and appear only when their corresponding workspace capability is enabled.

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

## External tool extensions

Prokop loads external tools directly from `~/.prokopai/tools/`, or from the directory configured by `PROKOPAI_TOOLS_PATH`. It does not provide a repository, downloader, installer, updater, or removal command.

Place each tool in its own directory. Čapek loads the entry named by an existing `.install-manifest.json`, then falls back to `tool.js`, then `tool.ts`. Built-in and domain tools win name collisions.

Prokop does not install dependencies or compile manually placed tools. Use a self-contained `tool.js`, or prepare the tool directory and its dependencies before placing it under the tools path.

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

A tool is a directory containing an ES module entry point:

```
my-tool/
├── tool.js          # Recommended self-contained entry point
├── package.json     # Optional, when runtime dependencies are prepared
└── VERSION          # Optional semantic version
```

### `tool.js` or `tool.ts`

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

### Activating a custom tool

Place the prepared directory at `~/.prokopai/tools/<tool-name>/`. The runtime scans for `tool.js` and `tool.ts` modules at startup and refreshes its directory snapshot while running. Restart the server when an immediate, guaranteed reload is required.
