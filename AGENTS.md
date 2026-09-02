# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

Prokop is an AI agent monorepo built with TypeScript and Bun.

- **Runtime and package manager**: Bun
- **Workspaces**: `packages/*` and `tools`
- **Server**: Hono backend in `packages/server` (`@prokopai/server`), with HTTP, WebSocket, terminal, SQLite, MCP, scheduling, permissions, and product-specific domain logic
- **Agent runtime**: External `@capekai/core` package, including execution, plugins, providers, tools, storage, compaction, goals, workflows, memory, skills, and sandbox behavior
- **Runtime contracts**: External `@capekai/types` package
- **Tool authoring contracts**: External `@capekai/tool` package
- **Client**: React 19, Vite 8, TanStack Router, TanStack Query, Zustand, shadcn/ui, Tailwind CSS v4, Storybook, and PWA support in `packages/client` (`@prokopai/client`)
- **SDK**: Product wire protocol, REST clients, WebSocket namespaces, shared product types, and transports in `packages/sdk` (`@prokopai/sdk`)
- **Browser extension**: Chrome extension for browser automation in `packages/browser` (`@prokopai/browser`)
- **Sandbox CLI**: Interactive LLM-call simulator in `packages/sandbox-cli` (`@prokopai/sandbox-cli`)
- **External tools**: Separately versioned TypeScript tool modules in `tools/`

## Architecture Boundaries

Keep changes in the package that owns the behavior.

- `@capekai/core` owns the reusable agent runtime and must remain independent of Prokop product packages.
- `@capekai/types` and `@capekai/tool` own neutral public contracts shared by the runtime, host, SDK, and external tools.
- `@prokopai/server` is the Prokop host. It composes Čapek, supplies storage and product adapters, and owns HTTP, WebSocket, CLI, MCP, SQLite, scheduling, notifications, permissions, and workspace behavior.
- `@prokopai/sdk` owns product-facing REST and WebSocket contracts. Do not move generic Čapek contracts back into the SDK.
- `@prokopai/client` consumes the SDK. Server-originated cache and store changes belong in mutation handlers or WebSocket handlers, not follow-up synchronization effects.
- Compatibility forwarding modules are intentional boundaries. Do not remove one without checking its consumers and the relevant boundary tests.

The current extraction and ownership record lives in `.architecture-v2/`. Read the relevant document before changing Čapek composition, server boundaries, compatibility shims, or public exports.

## Commands

### Install and Development

```bash
bun install

# Server and client
bun run dev
bun run dev:https

# Server only
bun run dev:server
bun run dev:be

# Client only
bun run dev:client
bun run dev:client:https

# Sandbox CLI for simulated LLM responses
bun run sandbox
```

Do not start a development server as part of verification unless the task specifically requires it.

### Build and Typecheck

```bash
# Build all workspaces
bun run build

# Typecheck all workspaces
bun run typecheck

# Build external tools
bun run build:tools

# Build the server binary for the current platform
bun run build:bin

# Platform-specific server binaries
bun run build:bin:macos
bun run build:bin:linux
bun run build:bin:windows

# Build server package and binary
bun run build:all

# Build and preview the production client
bun run preview
bun run preview:https
```

### Lint

```bash
bun run lint
bun run lint:fix
```

ESLint uses the flat config in `eslint.config.js`, with TypeScript, React, and React Hooks rules. The external `tools/` tree has its own Bun globals block.

### Tests

```bash
# Root suite: server, SDK, external tools, then client
bun run test

# Server
bun run test:server
bun run test:server:coverage

# Client, using Vitest
bun run test:client

# External tools
bun run test:tools
```

During development, run the smallest relevant test target. Run the full root checks before committing or releasing.

- **Server**: Bun test runner with `bun:test`
- **Client**: Vitest with `happy-dom`; Zustand stores can be tested through `useStore.getState()`
- **External tools**: Bun test runner with `tools/test-utils.ts`, which provides `createMockContext`, `VirtualFS`, and `WORKSPACE`
- **Server test aliases**: `#tests/db`, `#tests/factories`, `#tests/mocks`, `#tests/seed`, `#tests/test-dir`, `#tests/mock-ws`, and `#tests/wire-application`

Avoid live provider calls in tests. Use fake credentials, injected seams, or the sandbox provider.

### Client Storybook

```bash
cd packages/client
bun run storybook
bun run storybook:build
```

## Code Style

### Imports

- Use `import type` for type-only imports.
- Group external libraries first, then workspace packages (`@capekai/*`, `@prokopai/*`), then package-local imports.
- Use the `@/*` alias for package-local imports where that package config defines it.
- Import from a package's public export when crossing package boundaries. Avoid deep imports into another package's source tree.

```typescript
import { useEffect, useState } from 'react';
import type { Message, Session } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';
```

### TypeScript

- Strict mode is enabled.
- Prefer `interface` for object shapes and `type` for unions or primitives.
- Use explicit return types for exported functions.
- Avoid `any`; use `unknown` when a value has not been validated.
- Use `as const` for immutable literal definitions.
- Prefix intentionally unused variables with `_`.
- Keep public package types neutral. Product-specific fields belong in `@prokopai/sdk`, not `@capekai/types`.

### Naming and Formatting

- Variables and functions: camelCase
- React components and TypeScript types: PascalCase
- Environment-derived constants: SCREAMING_SNAKE_CASE
- Module files: camelCase; component files: PascalCase
- Use 2-space indentation, single quotes, and trailing commas in multiline structures.
- Add comments only when they explain non-obvious constraints or ordering.

### React

- React Compiler is configured in Vite through `@rolldown/plugin-babel` and `reactCompilerPreset({ target: '19' })`.
- Use functional components and hooks.
- Use Zustand for client state and TanStack Query for server data.
- TanStack Router uses generated file-based routes with automatic code splitting.
- UI primitives live in `packages/client/src/components/ui/` and follow shadcn/ui composition patterns.
- Use `useEffect` only to synchronize with an external system such as a browser API, timer, or non-reactive subscription.
- Do not use effects to copy query data into stores or synchronize stores with each other.
- Put query cache updates and invalidations in the mutation or WebSocket handler where the change originates.
- Server message handling lives under `packages/client/src/handlers/serverMessage/`.
- PWA update and recovery logic lives under `packages/client/src/pwa/`, with the service worker entry at `packages/client/src/sw.ts`.

### Error Handling

- Catch asynchronous boundary failures and type caught values as `unknown`.
- Preserve error context in logs without exposing credentials or tokens.
- Validate external, wire, tool, and provider input before use.
- Tool execution results use the contract defined by `@capekai/tool`; follow that package rather than introducing local lookalike types.
- Malformed permission, ask, capability, or authority responses must fail closed.

### Environment and Data Paths

- New server settings use the `PROKOPAI_` prefix.
- Client build-time settings use the `VITE_` prefix.
- Legacy `JEAN2_*` environment names remain supported where compatibility code explicitly handles them. Do not remove legacy support without a migration plan and compatibility tests.
- Canonical user data lives under `~/.prokopai`.
- Canonical workspace data lives under `<workspace>/.prokopai` and skills under `<workspace>/.agents/skills`.
- Never log provider credentials, auth tokens, OAuth material, or sensitive environment values.

### AI SDK and Providers

- Vercel AI SDK integration and provider registration live in the external `@capekai/core` package, not `packages/server`.
- Current provider integrations include OpenAI, DeepSeek, OpenRouter, MiniMax, and Zhipu.
- Prokop-specific provider accounts, credentials, and OAuth wiring live in the server adapters, application services, and provider-account domain.

### Sandbox

The sandbox CLI in `packages/sandbox-cli` intercepts LLM calls through `/api/sandbox` so end-to-end flows can be tested without live model calls.

- Runtime sandbox behavior: external `@capekai/core/sandbox` package subpath
- Server composition adapter: `packages/server/src/adapters/capek/sandbox.ts`
- HTTP routes: `packages/server/src/transport/http/routes/sandbox.ts`

## Project Structure

```text
packages/
  server/                # @prokopai/server Prokop host
    src/
      adapters/          # Čapek and compatibility adapters
      application/       # Use cases and ports
      bootstrap/         # Application and runtime composition
      cli/               # CLI commands and update tooling
      config/            # Models, credentials, schemas, and tool environment
      domains/           # Agents, controllers, notifications, providers, scheduling, tools, workspaces
      infrastructure/    # Daemon, filesystem, MCP, OAuth, providers, runtime, scheduling, and SQLite
      tools/builtin/     # Built-in file, shell, question, todo, and worktree tools
      transport/http/    # Hono app, middleware, and REST routes
      transport/terminal/ # Terminal framing and managers
      transport/websocket/ # WebSocket routing, delivery, handlers, and registries
      cli.ts             # Compiled `prokop` CLI entry
      index.ts           # Server entry

  client/                # @prokopai/client React web client and PWA
    src/
      components/        # Agent, app, board, chat, editor, files, layout, modals, views, and UI
      config/            # Auth, server URLs, identity, and persisted UI settings
      contexts/          # Server, session, pane, command, and view contexts
      handlers/serverMessage/ # WebSocket-driven cache and session updates
      hooks/             # Client hooks and TanStack Query hooks
      lib/               # Client utilities and cache synchronization
      notifications/     # Browser notification registration and handling
      pwa/               # Service worker registration, updates, and recovery
      routes/            # TanStack Router file routes
      stores/            # Zustand stores
      sw.ts              # Service worker entry

  sdk/                   # @prokopai/sdk product protocol and clients
    src/
      namespaces/        # WebSocket namespaces
      rest/              # REST clients
      shared-protocol/   # Client, server, and terminal wire protocol
      shared-types/      # Prokop product types
      shared-utils/      # Model context and tool display helpers
      transport/         # HTTP and WebSocket transports

  browser/               # @prokopai/browser Chrome extension
  sandbox-cli/           # @prokopai/sandbox-cli interactive simulator

tools/                   # External, separately released tool modules
  manifest.json          # Release manifest for external tools
  browser-*/             # Browser automation tools

.architecture-v2/        # Current extraction architecture, decisions, and validation
.agents/skills/          # Repository-specific agent procedures
changelogs/              # Client, SDK, server, and tool release notes
.github/workflows/       # release.yml and release-browser.yml
install/                 # install-prokopai.sh and install-prokopai.ps1
```

Built-in tools are not released from `tools/`. They live in `packages/server/src/tools/builtin/`. External tool directories contain `tool.ts`, `package.json`, and `VERSION`, implement the `@capekai/tool` contract, and use `ctx.ask()` for permission-sensitive operations.

## Working Practices

1. Read the relevant implementation and tests before describing or changing behavior.
2. For multi-package changes, identify the owning package and public boundary first.
3. Update focused tests with behavior changes, including malformed-input and compatibility cases at transport boundaries.
4. Do not use live LLM calls for verification.
5. Do not bump versions or edit release metadata unless the task explicitly requests a release change.

## Before Committing

Run the focused checks while developing. Before committing a completed cross-package change, run:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

For a narrowly scoped change, use package-level or file-level checks first, then expand only as needed.
