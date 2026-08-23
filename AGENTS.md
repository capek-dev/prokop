# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

Jean2 is an AI Agent monorepo built with TypeScript, Bun, React, and Hono.

- **Runtime**: Bun
- **Monorepo**: Workspace-based with packages in `packages/`
- **Server**: Hono + AI SDK with multi-provider support (packages/server)
- **Client**: React 19 + Vite 8 + TanStack Router + Zustand + shadcn/ui + Tailwind CSS v4, with PWA support (packages/client)
- **SDK**: Shared types, protocols, transport layer, WebSocket namespaces, and REST clients (packages/sdk)
- **Client Electron**: Electron desktop wrapper around the client (packages/client-electron)
- **Browser Extension**: Chrome extension for browser automation (packages/browser)
- **External Tools**: TypeScript tool modules, separately versioned and distributed (tools/). Each tool is a directory with `tool.ts`, `package.json`, and `VERSION`.
- **Sandbox CLI**: Interactive CLI for intercepting and simulating LLM responses in a running server, enabling end-to-end testing without real API calls (packages/sandbox-cli).

## Build Commands

```bash
# Install dependencies
bun install

# Development (runs both server and client)
bun run dev

# Development with HTTPS
bun run dev:https

# Development - server only
bun run dev:server
# Alias
bun run dev:be

# Development - client only
bun run dev:client
bun run dev:client:https

# Development - Electron desktop
bun run dev:electron

# Build all packages
bun run build

# Build tools
bun run build:tools

# Type check all packages
bun run typecheck

# Build server binary (current platform)
bun run build:bin

# Build server binary for specific platform
bun run build:bin:macos
bun run build:bin:linux
bun run build:bin:windows

# Build server package + binary
bun run build:all

# Preview production client build
bun run preview
bun run preview:https

# Build Electron desktop app
bun run electron:build
bun run electron:build:mac:local
bun run electron:build:mac:release
bun run electron:build:win

# Start sandbox CLI
bun run sandbox
```

## Lint Commands

```bash
# Run ESLint
bun run lint

# Run ESLint with auto-fix
bun run lint:fix
```

ESLint uses flat config (`eslint.config.js`) with `typescript-eslint`, `eslint-plugin-react`, and `eslint-plugin-react-hooks`. The `tools/` directory is linted with its own Bun globals config.

## Test Commands

```bash
# Run all tests (server + sdk + tools + client)
bun run test

# Server tests (Bun test runner)
bun run test:server
bun run test:server:coverage

# Client tests (Vitest)
bun run test:client

# Tool tests (Bun test runner)
bun run test:tools
```

- **Server**: Uses `bun:test` with `describe`/`test`/`expect`/`beforeEach`/`afterEach`. Test helpers in `packages/server/tests/helpers/` with import aliases (`#tests/db`, `#tests/factories`, `#tests/seed`, `#tests/mocks`, `#tests/test-dir`).
- **Client**: Uses Vitest with `describe`/`test`/`expect`/`beforeEach`. Zustand stores tested via `useStore.getState()` directly.
- **Tools**: Uses `bun:test` with shared `test-utils.ts` providing `createMockContext`, `VirtualFS`, and `WORKSPACE` for virtual filesystem testing.

## Code Style

### Imports

- Use `import type` for type-only imports
- Group imports: external libraries first, then internal packages (`@jean2/*`), then local (`@/`)
- Use `@/*` path alias for relative imports within the same package

```typescript
import { useState, useEffect } from 'react';
import type { Session, Message } from '@jean2/sdk';
import { fetchMessages } from '@/store';
import './styles.css';
```

### Naming Conventions

- **Variables/Functions**: camelCase (`getUserById`, `isLoading`)
- **Components**: PascalCase (`ChatView`, `SessionList`)
- **Types/Interfaces**: PascalCase (`Session`, `ToolDefinition`)
- **Type aliases**: PascalCase (`SessionStatus`, `ToolRuntime`)
- **Constants**: SCREAMING_SNAKE_CASE for env-derived (`PROKOPAI_LLM_MAX_TOKENS`), camelCase otherwise
- **Files**: camelCase for modules (`agent.ts`), PascalCase for components (`ChatView.tsx`)

### TypeScript

- Strict mode enabled
- Prefer `interface` for object shapes, `type` for unions/primitives
- Use explicit return types for exported functions
- Avoid `any`; use `unknown` when type is uncertain
- Use `as const` for literal objects that should be immutable
- Unused vars prefixed with `_` (e.g., `_e`, `_sessionId`)

```typescript
export interface ChatOptions {
  sessionId: string;
  messages: Message[];
}

export type SessionStatus = 'active' | 'closed';

export async function getTool(name: string): Promise<DiscoveredTool | null> {
  // ...
}
```

### React

- React 19 with React Compiler (configured in Vite via `babel-plugin-react-compiler`)
- Functional components with hooks
- Destructure props in function signature
- Use `export default` for page/container components
- Named exports for utility components/hooks
- State management via Zustand stores (`packages/client/src/stores/`)
- Server data via TanStack Query hooks (`packages/client/src/hooks/queries/`)
- Routing via TanStack Router with file-based code splitting
- UI components built on shadcn/ui (Radix primitives + Tailwind)

```typescript
interface Props {
  session: Session;
  onSendMessage: (content: string) => void;
}

export default function ChatView({ session, onSendMessage }: Props) {
  const [input, setInput] = useState('');
  // ...
}
```

### Error Handling

- Return error objects with `success` boolean for tool execution
- Use try/catch for async operations; type catch as `unknown`
- Log errors with context before returning

```typescript
export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

try {
  const result = await executeOperation();
  return { success: true, result };
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Operation failed:', message);
  return { success: false, error: message };
}
```

### Formatting

- No comments unless absolutely necessary for complex logic
- 2-space indentation
- Single quotes for strings (double quotes only when required)
- Trailing commas in multiline structures

### Environment Variables

- Prefix with `PROKOPAI_` for server application settings, `VITE_` for client build-time settings
- Access via `process.env.VAR_NAME` (server) or `import.meta.env.VITE_VAR_NAME` (client)
- Provide defaults with `||` or `??`

```typescript
const PROKOPAI_LLM_MAX_TOKENS = parseInt(process.env.PROKOPAI_LLM_MAX_TOKENS || '4096', 10);
```

### AI SDK (Server)

- Server uses Vercel AI SDK (`ai` package) for all LLM interactions
- Supported providers: OpenAI (`@ai-sdk/openai`), DeepSeek (`@ai-sdk/deepseek`), OpenRouter (`@openrouter/ai-sdk-provider`), MiniMax (`vercel-minimax-ai-provider`), Zhipu (`zhipu-ai-provider`)
- Provider registry pattern in `packages/server/src/providers/`

### Sandbox CLI

The sandbox CLI (`packages/sandbox-cli`) intercepts all LLM calls in a running server and lets you manually or automatically respond — enabling full end-to-end testing of agent flows without real API calls. Start it with `bun run sandbox`. See `packages/sandbox-cli/src/cli.ts` for CLI usage and `packages/server/src/sandbox/` for server-side implementation.

## Project Structure

```
packages/
  server/                # Hono backend (@jean2/server)
    src/
      auth/              # Authentication middleware (env-var based, off by default)
      config/            # Model configurations (models.json)
      configuration/     # Runtime configuration (models, preconfigs, prompts, credentials)
      core/              # Agent logic, streaming, subagents, compaction, retry, forking
      daemon/            # Background daemon process
      mcp/               # Model Context Protocol integration (OAuth, stdio transport)
      providers/         # AI provider registry and storage
      prompts/           # Prompt registry
      routes/            # REST API route handlers (config, files, mcp, sessions, tools, workspaces)
      sandbox/           # Sandbox provider, model, controller, routes (simulated LLM)
      services/          # Terminal sessions, file preview, file operations, client launcher
      skills/            # Skill registry and tool integration
      store/             # SQLite data layer (sessions, messages, permissions, attachments, etc.)
      tools/             # Tool execution, registry, installer, bundler, Ask protocol
      types/             # Third-party type declarations
      utils/             # Binary detection, error handling, truncation utilities
      app.ts             # Hono app setup
      cli.ts             # CLI entry point
      env.ts             # Environment configuration
      index.ts           # Server entry point
      init.ts            # Server initialization
      paths.ts           # Data directory path resolution
      version.ts         # Version constant

  client/                # React frontend (@jean2/client) — also works as PWA
    src/
      components/
        app/             # App-level layout (header, main content, panels)
        chat/            # Chat UI (messages, input, model selector, tool calls)
        files/           # File tree, file preview, file autocomplete
        layout/          # Sidebar, terminal, workspace switching, file panels
        modals/          # Dialogs (settings, configuration, MCP, permissions)
        providers/       # Store hydration, theme provider, QueryClient
        shared/          # Shared UI (markdown renderer, loading states)
        shell/           # Server connection shell
        ui/              # shadcn/ui primitives (button, dialog, tabs, etc.)
        views/           # View-level components (Overview, Session, Workspace)
        visualizations/  # Diff viewer, code block, terminal output, todo list renderers
      config/            # Auth, server URLs, draft/panel storage, client identity
      contexts/          # React contexts (server, session manager, view refs)
      handlers/          # Server message handlers (ask, control, message parts, permissions, providers, sessions)
      hooks/             # Custom React hooks + TanStack Query hooks (queries/)
      lib/               # Utility libraries (platform detection, server registry, storage, paths)
      routes/            # TanStack Router file-based routes
      stores/            # Zustand stores (session, connection, chat layout, UI state, ask, completion, etc.)
      types/             # Client-specific type definitions
      utils/             # Utilities (diff, version)
      assets/            # Static assets (notification sounds)
      cli.ts             # Local dev server for npx
      main.tsx           # React entry point
      router.tsx         # TanStack Router setup
      routeTree.gen.ts   # Auto-generated route tree
      index.css          # Global styles (Tailwind)

  sdk/                   # Shared SDK (@jean2/sdk)
    src/
      namespaces/        # WebSocket namespace clients (chat, sessions, terminal, control, permissions, queue, providers)
      rest/              # REST API clients (attachments, config, files, mcp, models, preconfigs, prompts, providers, sessions, tools, workspaces)
      shared-protocol/   # Shared protocol definitions (client, server, terminal)
      shared-types/      # Shared TypeScript types (configuration, control, file, interrupt, mcp, message, model, permission, preconfig, prompt, provider, runtime, server, session, skill, task, tool, ui, visualization, workspace)
      shared-utils/      # Shared utilities (model context helpers)
      transport/         # Transport layer (HTTP, WebSocket)
      types/             # SDK-level types (REST responses, server messages, SDK types)
      client.ts          # Main SDK client class (Jean2Client)
      emitter.ts         # Event emitter (TypedEventEmitter)
      errors.ts          # Error types (Jean2Error, ConnectionError, AuthError, etc.)
      index.ts           # Public API entry point
      shared.ts          # Barrel file re-exporting shared-types, shared-protocol, shared-utils
      version.ts         # Version constant

  client-electron/       # Electron desktop app (@jean2/client-electron)
    src/
      main.ts            # Electron main process
      preload.ts         # Preload script
      ipc-handlers.ts    # IPC communication handlers
      server-manager.ts  # Embedded server lifecycle management
      updater.ts         # Auto-update via electron-updater
      menu.ts            # Application menu
      webview-manager.ts # WebView management

  browser/               # Browser extension (@jean2/browser)
    src/
      background.ts      # Background service worker
      client.ts          # Extension client logic
      config.ts          # Extension configuration
      content.ts         # Content script
      popup.ts           # Popup UI logic
      storage.ts         # Extension storage
      types.ts           # Extension type definitions
    manifest.json        # Browser extension manifest
    popup.html           # Popup HTML
    icons/               # Extension icons (16, 32, 48, 128)

  sandbox-cli/           # Sandbox CLI for simulating LLM responses (@jean2/sandbox-cli)
    src/
      cli.ts             # CLI entry point, readline interactive loop
      commands.ts        # Command parsing and dispatch (respond, auto-respond, pending, etc.)
      api-client.ts      # HTTP + WebSocket client for /api/sandbox/* endpoints
      display.ts         # Terminal display formatting (colors, tables, call details)
      types.ts           # CLI-specific type definitions

tools/                   # External tool modules (independent from main project)
  # File tools: apply-patch, edit, glob, grep, ls, multiedit, read-file, write-file
  # Shell tool: shell
  # Web tools: webfetch, file-to-markdown
  # Browser tools: browser-discover-elements, browser-dom-action, browser-navigate,
  #   browser-read-active-tab, browser-screenshot, browser-tab-manage
  # Interaction tools: question, todoread, todowrite
  # Tavily tools: tavily-crawl, tavily-extract, tavily-map, tavily-search
  # Testing tools: llm-test
  # Each tool directory contains:
  #   tool.ts              # Tool implementation + metadata (TypeScript, compiled at install)
  #   package.json         # Dependencies
  #   VERSION              # Semantic version
  #   *.test.ts            # Tests (optional, using bun:test + VirtualFS)
  # Tools are separately versioned and distributed via GitHub Releases
  # Tools use the @capekai/tool ToolModule interface with ctx.ask() for the Ask protocol

changelogs/              # Version changelogs
  client/                # Client release notes
  server/                # Server release notes
  tools/                 # Per-tool release notes

.agents/                 # Agent skill definitions
  skills/
    shadcn/              # shadcn/ui skill (SKILL.md, rules, evals, assets, agent configs)

.github/                 # CI/CD workflows
  workflows/
    release.yml          # Server + tools release (cross-platform binaries)
    release-electron.yml # Electron desktop release (macOS + Windows)
    release-browser.yml  # Browser extension release
    cleanup-releases.yml # Weekly cleanup of old releases

install/                 # Installation scripts and documentation
  install-prokopai.sh       # Unix installer
  install-prokopai.ps1      # Windows installer
```

## Before Committing

1. Run `bun run typecheck` - must pass
2. Run `bun run lint` - must pass
3. Run `bun run test` - must pass
4. Run `bun run build` - must succeed
