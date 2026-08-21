# @jean2/sdk

The official TypeScript SDK for Jean2. Provides a typed client for connecting to a Jean2 server over WebSocket and REST — with zero production dependencies.

## Install

```bash
bun add @jean2/sdk
# or
npm install @jean2/sdk
```

## Quick Start

```typescript
import { Jean2Client } from '@jean2/sdk';

const client = new Jean2Client({
  url: 'http://localhost:3000',
  token: 'your-auth-token',            // optional, required if server auth is enabled
  clientDescriptor: {
    clientId: 'my-app',
    clientType: 'sdk',                 // 'desktop' | 'web' | 'extension' | 'sdk' | 'mobile'
    displayName: 'My App',
    interactionMode: 'headless',       // 'human' | 'headless' | 'hybrid'
    capabilities: ['chat_ui', 'ask_ui'],
  },
});

// Listen for events
client.on('connected', () => console.log('Connected!'));
client.on('session.created', (session) => console.log('Session:', session.id));
client.on('message.created', (message) => console.log('Message:', message));

// Connect
await client.connect();
```

## Table of Contents

- [Client Configuration](#client-configuration)
- [Connection Lifecycle](#connection-lifecycle)
- [WebSocket Namespaces](#websocket-namespaces)
  - [Sessions](#sessions)
  - [Chat](#chat)
  - [Permissions](#permissions)
  - [Queue](#queue)
  - [Providers](#providers)
  - [Control](#control)
  - [Terminal](#terminal)
- [REST API (http namespace)](#rest-api-http-namespace)
  - [Sessions](#sessions-rest)
  - [Workspaces](#workspaces)
  - [Models](#models)
  - [Tools](#tools)
  - [Providers](#providers-rest)
  - [Preconfigs](#preconfigs)
  - [Prompts](#prompts)
  - [Files](#files)
  - [Attachments](#attachments)
  - [Terminals](#terminals-rest)
  - [MCP](#mcp)
  - [Config](#config)
  - [Loading All Data](#loading-all-data)
- [Events](#events)
  - [Lifecycle Events](#lifecycle-events)
  - [Session Events](#session-events)
  - [Message Events](#message-events)
  - [Ask Events](#ask-events)
  - [Permission Events](#permission-events)
  - [Queue Events](#queue-events)
  - [Provider Events](#provider-events)
  - [Error Events](#error-events)
- [Core Types](#core-types)
  - [Session](#session-type)
  - [Messages & Parts](#messages--parts)
  - [Permissions](#permissions-type)
  - [Ask Protocol](#ask-protocol-types)
  - [Workspaces](#workspace-type)
  - [Models & Providers](#models--providers)
  - [Preconfigs](#preconfig-type)
  - [MCP](#mcp-type)
- [Error Handling](#error-handling)
- [Transport Layer](#transport-layer)
  - [HTTP Client](#http-client)
  - [WebSocket Transport](#websocket-transport)
- [Utility Functions](#utility-functions)
- [Terminal Namespace](#terminal-namespace-detail)

---

## Client Configuration

```typescript
interface ClientConfig {
  // Server URL (required)
  url: string;

  // Auth token for Bearer authentication (optional)
  token?: string;

  // Custom WebSocket constructor (optional, useful in Node.js)
  wsConstructor?: typeof WebSocket;

  // API base path (default: "/api")
  apiBase?: string;

  // Connection timeout in milliseconds (default: 10000)
  connectionTimeout?: number;

  // Client registration descriptor (optional)
  clientDescriptor?: ClientDescriptor;
}
```

### ClientDescriptor

When provided, the client automatically sends a `client.register` message on connect. The server uses this for session control, ask routing, and capability checks.

```typescript
interface ClientDescriptor {
  clientId: string;
  clientType: 'desktop' | 'web' | 'extension' | 'sdk' | 'mobile';
  displayName: string;
  interactionMode: 'human' | 'headless' | 'hybrid';
  capabilities: string[];              // e.g. ['chat_ui', 'ask_ui', 'terminal_ui']
  instanceMetadata?: Record<string, unknown>;
}
```

**Well-known capabilities:** `chat_ui`, `ask_ui`, `browser_automation`, `active_tab_read`, `tab_context`, `notifications`, `terminal_ui`, `file_picker`.

---

## Connection Lifecycle

```typescript
const client = new Jean2Client({ url: 'http://localhost:3000' });

// Connect to the server
await client.connect();

// Check state
client.state;        // 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
client.connected;    // boolean
client.connectionId; // string | null (set after registration)
client.clientId;     // string | null (from registered descriptor)

// Graceful disconnect
await client.disconnect();

// Disconnect and clean up all listeners
await client.dispose();
```

---

## WebSocket Namespaces

All WebSocket namespaces are accessed as properties on the `Jean2Client` instance. They send typed messages to the server and results arrive as [events](#events).

### Sessions

```typescript
client.sessions.create({ workspaceId, preconfigId, title });
client.sessions.resume(sessionId);
client.sessions.close(sessionId);
client.sessions.reopen(sessionId);
client.sessions.delete(sessionId);
client.sessions.rename(sessionId, 'New Title');
client.sessions.update(sessionId, { preconfigId });
client.sessions.updateModel(sessionId, { modelId, providerId, variant });
client.sessions.compact(sessionId);
client.sessions.revert(sessionId, messageId);
client.sessions.fork(sessionId, messageId, title);
client.sessions.interrupt(sessionId, reason);
```

**`interrupt` reason:** `'user_request'` | `'timeout'` | `'error'`

### Chat

```typescript
client.chat.send(sessionId, 'Hello, how are you?');

// With attachments
client.chat.send(sessionId, 'Check this image', {
  attachments: [{ id: 'att-123', kind: 'image' }],
});
```

### Permissions

```typescript
client.permissions.list(workspaceId, includeRevoked);
client.permissions.revoke(grantId);
client.permissions.revokeAll(workspaceId);
```

### Queue

Queue messages for later sending (e.g., while a session is busy).

```typescript
client.queue.add(sessionId, 'Follow-up message', attachments);
client.queue.remove(queueId);
```

### Providers

```typescript
client.providers.connect('anthropic');
client.providers.disconnect('openai');
```

### Control

Session control for multi-client scenarios (claim/release ownership, takeover).

```typescript
client.control.claim(sessionId);
client.control.release(sessionId);
client.control.requestTakeover(sessionId);
client.control.respondTakeover(sessionId, requesterClientId, 'approve');
```

---

## REST API (http namespace)

All REST methods return promises and are accessed via `client.http.<namespace>`.

```typescript
const client = new Jean2Client({ url: 'http://localhost:3000' });
// No need to connect() — REST works without WebSocket
```

### Sessions (REST)

```typescript
// List all sessions
const { sessions } = await client.http.sessions.list({ status: 'active' });

// Create a session
const { session } = await client.http.sessions.create({
  workspaceId: 'ws-1',
  title: 'My Session',
});

// Get a session with its messages
const { session, messages, usage, control } = await client.http.sessions.get(sessionId);

// Update session
await client.http.sessions.update(sessionId, { title: 'Renamed' });

// Delete session
await client.http.sessions.delete(sessionId);

// List messages for a session
const { messages } = await client.http.sessions.listMessages(sessionId);

// List sessions grouped by workspace
const grouped = await client.http.sessions.listGrouped({
  workspaceIds: ['ws-1', 'ws-2'],
  rootOnly: true,
});

// List sessions for a workspace
const { sessions } = await client.http.sessions.listByWorkspace({
  workspaceId: 'ws-1',
});
```

### Workspaces

```typescript
const { workspaces } = await client.http.workspaces.list();
const { workspace } = await client.http.workspaces.create({ name: 'My Project', path: '/path' });
const { workspace } = await client.http.workspaces.get(workspaceId);
await client.http.workspaces.update(workspaceId, { name: 'Renamed' });
await client.http.workspaces.delete(workspaceId);
const { sessions } = await client.http.workspaces.listSessions(workspaceId);
```

### Models

```typescript
const { models, defaultModel, defaultProvider } = await client.http.models.list();
```

### Tools

```typescript
const { tools } = await client.http.tools.list();
const { tool } = await client.http.tools.get('read-file');
const { envVars } = await client.http.tools.listEnvVars();
await client.http.tools.setEnvVar('API_KEY', { value: 'sk-...' });
await client.http.tools.clearEnvVar('API_KEY');
```

### Providers (REST)

```typescript
const { providers } = await client.http.providers.list();
const { status } = await client.http.providers.getStatus('anthropic');
await client.http.providers.connect('anthropic');
await client.http.providers.disconnect('openai');
const { credentials } = await client.http.providers.listCredentials();
await client.http.providers.setCredential('anthropic', { apiKey: 'sk-...' });
await client.http.providers.clearCredential('anthropic');
```

### Preconfigs

```typescript
const { preconfigs } = await client.http.preconfigs.list();
const { preconfig } = await client.http.preconfigs.create({
  name: 'Code Helper',
  description: 'Helps with coding tasks',
  systemPrompt: 'You are a helpful coding assistant.',
  tools: ['read-file', 'write-file'],
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  mode: 'primary',
});
const { preconfig } = await client.http.preconfigs.get(preconfigId);
await client.http.preconfigs.update(preconfigId, { name: 'Updated Name' });
await client.http.preconfigs.delete(preconfigId);
```

### Prompts

```typescript
const { prompts } = await client.http.prompts.list();
```

### Files

```typescript
// Browse workspace directory
const { entries } = await client.http.files.browse(workspaceId, '/src', { showHidden: true });

// Search files by name
const { entries } = await client.http.files.search(workspaceId, '*.ts');

// Preview file content
const { content } = await client.http.files.preview(workspaceId, '/src/index.ts');

// Browse server filesystem
const { entries } = await client.http.files.browseFs('/');

// Get parent directory
const { parent } = await client.http.files.parent('/src/index.ts');

// List available drives (Windows)
const { drives } = await client.http.files.drives();
```

### Attachments

```typescript
const { attachments } = await client.http.attachments.list(sessionId);
const { attachment } = await client.http.attachments.upload(sessionId, fileBlob);

// Get attachment URL (no HTTP call — builds the URL string)
const url = client.http.attachments.getUrl(sessionId, attachmentId, 'thumbnail');
```

### Terminals (REST)

```typescript
const { sessions } = await client.http.terminals.list(workspaceId);
const { session } = await client.http.terminals.create(workspaceId, { cwd: '/project' });
const { session } = await client.http.terminals.get(workspaceId, sessionId);
await client.http.terminals.delete(workspaceId, sessionId);
```

### MCP

Model Context Protocol integration.

```typescript
const { status } = await client.http.mcp.getStatus(workspaceId);
await client.http.mcp.connect(workspaceId, 'my-mcp-server');
await client.http.mcp.disconnect(workspaceId, 'my-mcp-server');
await client.http.mcp.startAuth(workspaceId, 'remote-mcp');
await client.http.mcp.finishAuth(workspaceId, 'remote-mcp', 'auth-code');
```

### Config

Runtime configuration for models, providers, and prompts.

```typescript
// Models config
const config = await client.http.config.models.get();
await client.http.config.models.createProvider({ id: 'my-provider', name: 'My Provider' });
await client.http.config.models.updateProvider('my-provider', { name: 'Updated' });
await client.http.config.models.deleteProvider('my-provider');
await client.http.config.models.createModel('my-provider', { id: 'my-model', name: 'My Model' });
await client.http.config.models.updateModel('my-provider', 'my-model', { name: 'Updated' });
await client.http.config.models.deleteModel('my-provider', 'my-model');
await client.http.config.models.setDefaults({ defaultModel: 'gpt-4o', defaultProvider: 'openai' });

// Prompts config
const { prompts } = await client.http.config.prompts.list();
const { prompt } = await client.http.config.prompts.get('system');
await client.http.config.prompts.create({ name: 'custom', content: '...' });
await client.http.config.prompts.update('custom', { content: 'updated' });
await client.http.config.prompts.delete('custom');
```

### Loading All Data

Fetch all initial data in a single parallel call.

```typescript
const data = await client.http.loadAll();
// data.workspaces, data.preconfigs, data.prompts, data.models,
// data.defaultModel, data.defaultProvider, data.providers
```

---

## Events

The SDK uses a typed event emitter. All event handlers receive typed arguments.

```typescript
// Add listener
client.on('session.created', (session) => { ... });

// One-time listener
client.once('connected', () => { ... });

// Remove listener
const handler = (session) => { ... };
client.on('session.created', handler);
client.off('session.created', handler);

// Wildcard — catches all events
client.on('*', (event) => {
  console.log(event.source, event.type);  // 'lifecycle' | 'server', event name
});
```

### Lifecycle Events

| Event | Args | Description |
|-------|------|-------------|
| `connected` | `()` | WebSocket connected |
| `disconnected` | `{ code, reason, wasClean }` | WebSocket disconnected |
| `error.connection` | `Error` | Connection error |

### Client Registration Events

| Event | Args | Description |
|-------|------|-------------|
| `client.registered` | `client, connectionId, serverTime` | Client registered with server |
| `client.rejected` | `code, message` | Registration rejected |

### Session Events

| Event | Args | Description |
|-------|------|-------------|
| `session.created` | `session` | New session created |
| `session.resumed` | `session, messages, usage, isRunning, control` | Session resumed with full state |
| `session.updated` | `session` | Session updated |
| `session.renamed` | `session` | Session renamed |
| `session.closed` | `sessionId` | Session closed |
| `session.reopened` | `session` | Session reopened |
| `session.deleted` | `sessionId` | Session deleted |
| `session.interrupted` | `sessionId, result` | Session interrupted |
| `session.reverted` | `sessionId, revertedTo, removed` | Session reverted to a message |
| `session.forked` | `originalSessionId, forkedSession, messages` | Session forked |
| `session.state` | `sessionId, messages` | Full session state snapshot |
| `session.control.updated` | `control, reason` | Session control changed |
| `session.action_rejected` | `sessionId, action, code, message, control` | Action rejected by server |

### Message Events

| Event | Args | Description |
|-------|------|-------------|
| `message.created` | `message` | New message |
| `message.updated` | `message` | Message updated |
| `part.created` | `sessionId, part` | New part (text, tool call, etc.) |
| `part.updated` | `sessionId, part` | Part updated (tool completed, etc.) |
| `part.append` | `sessionId, partId, field, delta` | Streaming text/reasoning delta |

### Chat Events

| Event | Args | Description |
|-------|------|-------------|
| `chat.usage` | `sessionId, usage, model, variant` | Token usage for a response |
| `compaction.complete` | `sessionId, tokensUsed` | Context compaction completed |

### Ask Events

Interactive prompts from tools (permissions, questions, forms).

| Event | Args | Description |
|-------|------|-------------|
| `ask.request` | `sessionId, toolCallId, toolName, ask, requestId, authority` | Tool is asking for user input or permission |
| `ask.response_rejected` | `sessionId, toolCallId, requestId, code, message` | Ask response was rejected |
| `ask.timeout` | `sessionId, toolCallId, requestId` | Ask request timed out |
| `ask.pending_sync` | `sessionId, requests` | Server synced pending ask requests |

**Responding to an ask:**

```typescript
client.on('ask.request', (sessionId, toolCallId, toolName, ask, requestId) => {
  if (ask.type === 'permission') {
    // Show permission dialog
    client.send({
      type: 'ask.response',
      toolCallId,
      response: { type: 'permission', grant: 'session' },  // 'once' | 'session' | 'workspace' | 'deny'
      requestId,
    });
  }

  if (ask.type === 'confirm') {
    client.send({
      type: 'ask.response',
      toolCallId,
      response: { type: 'confirm', value: true },
      requestId,
    });
  }
});
```

### Permission Events

| Event | Args | Description |
|-------|------|-------------|
| `permission.list` | `workspaceId, grants` | Permission list received |
| `permission.revoked` | `grantId` | A grant was revoked |
| `permission.all_revoked` | `workspaceId, count` | All grants revoked for workspace |

### Queue Events

| Event | Args | Description |
|-------|------|-------------|
| `queue.list` | `sessionId, messages` | Queue state received |
| `queue.added` | `sessionId, message` | Message added to queue |
| `queue.removed` | `sessionId, queueId` | Message removed from queue |
| `queue.sending` | `sessionId, queueId` | Queued message is being sent |

### Provider Events

| Event | Args | Description |
|-------|------|-------------|
| `provider.status` | `provider, connected, authorizationUrl, error` | Provider status update |
| `provider.connected` | `provider, connected, connectedAt, accountId` | Provider connection changed |

### Error Events

| Event | Args | Description |
|-------|------|-------------|
| `error` | `code, message` | Generic error |
| `error.rate_limit` | `code, message, retryAfterMs` | Rate limited |
| `error.server` | `code, message, retryAfterMs` | Server error |
| `error.timeout` | `code, message, retryAfterMs` | Timeout |
| `error.auth` | `code, message` | Authentication error |
| `error.invalid_request` | `code, message` | Invalid request |
| `error.context_overflow` | `code, message` | Context window exceeded |

---

## Core Types

### Session Type

```typescript
interface Session {
  id: string;
  workspaceId: string;
  preconfigId: string | null;
  title: string | null;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown> | null;
  selectedModel?: string | null;
  selectedProvider?: string | null;
  selectedVariant?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  parentId: string | null;
  agentName: string | null;
  subagentStatus?: 'running' | 'completed' | 'error' | 'interrupted' | null;
  runningAt?: string | null;
  compacting?: boolean;
}
```

### Messages & Parts

Messages are composed of typed parts. A message's content arrives via streaming `part.created`, `part.updated`, and `part.append` events.

```typescript
type MessageRole = 'user' | 'assistant' | 'system';
type AssistantStatus = 'streaming' | 'completed' | 'error' | 'interrupted';

interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  createdAt: string;
  // ...role-specific fields
}

// Parts
type Part =
  | TextPart          // { type: 'text', text: string }
  | ReasoningPart     // { type: 'reasoning', text: string }
  | ToolPart          // { type: 'tool', callId, name, state: ToolState, ... }
  | FilePart          // { type: 'file', mimeType, filename?, url }
  | ImagePart         // { type: 'image', url, mimeType? }
  | StepPart          // { type: 'step', number, status, finishReason?, tokens?, cost? }
  | CompactionPart;   // { type: 'compaction', auto, overflow? }
```

**Tool state** (`ToolState`) tracks the lifecycle: `pending` → `running` → `completed` | `error` | `interrupted`.

### Permissions Type

```typescript
type PermissionRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
type GrantScope = 'once' | 'session' | 'workspace';
type GrantMatcher = 'exact' | 'prefix' | 'glob' | 'shell-command';
type PermissionResource = 'file' | 'path' | 'directory' | 'shell-command' | 'network' | 'env' | 'clipboard' | string;

interface PermissionGrant {
  id: string;
  workspaceId: string;
  toolName: string;
  resource: PermissionResource;
  action?: string;
  scope: GrantScope;
  matcher: GrantMatcher;
  patterns: string[];
  allowed: boolean;
  grantedAt: string;
  expiresAt: string | null;
  // ...
}
```

### Ask Protocol Types

Tools interact with users through the Ask protocol — typed requests for permissions, questions, forms, and client capabilities.

```typescript
type AskTarget = 'human' | 'client' | 'permission';

// Questions
interface SingleSelectQuestion { type: 'single_select'; question: string; options: Array<{ label, value, description? }>; }
interface MultiSelectQuestion { type: 'multi_select'; question: string; options: Array<{ label, value, description? }>; min?; max?; }
interface TextQuestion { type: 'text'; question: string; placeholder?; defaultValue?; }
interface ConfirmQuestion { type: 'confirm'; question: string; defaultValue?; }

// Ask = PermissionAsk | HumanQuestion | ClientCapabilityAsk
```

### Workspace Type

```typescript
interface Workspace {
  id: string;
  name: string;
  path: string;
  isVirtual: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Models & Providers

```typescript
type ModelTier = 'budget' | 'standard' | 'premium';

interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  tier: ModelTier;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: ModelCapabilities;
}

interface ProviderDefinition {
  id: string;
  name: string;
  models: ModelDefinition[];
}
```

### Preconfig Type

```typescript
type PreconfigMode = 'primary' | 'subagent' | 'both';

interface Preconfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  provider: string | null;
  variant?: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: PreconfigMode;
  canSpawnSubagents?: boolean | string[] | null;
  skills?: string[] | null;
}
```

### MCP Type

```typescript
type McpServerType = 'local' | 'remote';

// Local: stdio-based MCP server
interface McpLocalServerConfig {
  type: 'local';
  command: string[];
  env?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

// Remote: HTTP-based MCP server with optional OAuth
interface McpRemoteServerConfig {
  type: 'remote';
  url: string;
  oauth?: boolean | McpOAuthConfig;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}
```

---

## Error Handling

The SDK exports a hierarchy of error classes:

```typescript
import { Jean2Error, ConnectionError, AuthError, RateLimitError, TimeoutError, ServerError, ValidationError } from '@jean2/sdk';

try {
  await client.connect();
} catch (err) {
  if (err instanceof ConnectionError) {
    // WebSocket connection failed
  } else if (err instanceof AuthError) {
    // Authentication failed
  } else if (err instanceof RateLimitError) {
    // Rate limited — check err.retryAfterMs
  }
}
```

| Error | Description |
|-------|-------------|
| `Jean2Error` | Base error class for all SDK errors |
| `ConnectionError` | WebSocket connection failures |
| `AuthError` | Authentication failures |
| `RateLimitError` | Rate limited (`retryAfterMs` property) |
| `TimeoutError` | Request timeouts |
| `ServerError` | Server-side errors (`statusCode` property) |
| `ValidationError` | Invalid input (`statusCode` property, default 400) |

---

## Transport Layer

The SDK uses two transport layers — you don't normally need to interact with them directly.

### HTTP Client

```typescript
const httpClient = client.httpClient;

// Generic request
const data = await httpClient.request<MyType>('/sessions', { method: 'POST', body: { ... } });

// Convenience methods
await httpClient.get('/sessions');
await httpClient.post('/sessions', { title: 'New' });
await httpClient.put('/sessions/123', { title: 'Updated' });
await httpClient.patch('/sessions/123', { title: 'Updated' });
await httpClient.delete('/sessions/123');

// Verify token before connecting
const valid = await HttpClient.verifyToken('http://localhost:3000', 'my-token');
```

### WebSocket Transport

The WebSocket transport handles heartbeat (ping/pong every 30s) and automatic message serialization.

```typescript
// Transport is internal — use client.connect() / client.disconnect() instead
// Access the raw WebSocket if needed:
client.ws;  // WebSocket | null
```

---

## Utility Functions

### Type Guards

```typescript
import { isTextPart, isToolPart, isReasoningPart, isStepPart, isImagePart, isFilePart, isCompactionPart, isAssistantMessage, isUserMessage } from '@jean2/sdk';

if (isToolPart(part)) {
  console.log(part.callId, part.name, part.state);
}
```

### Shell Permission Helpers

```typescript
import {
  SHELL_DANGEROUS_COMMANDS,
  SHELL_FILESYSTEM_COMMANDS,
  SENSITIVE_FILE_PATTERNS,
  splitShellCommandSegments,
  createShellPermissionAskStructured,
  analyzeShellCommandEffects,
} from '@jean2/sdk';
```

---

## Terminal Namespace (Detail)

The terminal namespace manages interactive terminal sessions via dedicated WebSocket connections (separate from the main connection).

### Connecting to a Terminal

```typescript
const termConn = await client.terminal.connect({
  workspaceId: 'ws-1',
  cwd: '/project',
  shell: '/bin/bash',       // optional
});

// TerminalConnection extends TypedEventEmitter
termConn.on('output', (data: Uint8Array) => {
  process.stdout.write(data);
});

termConn.on('exit', (exitCode: number) => {
  console.log('Exited:', exitCode);
});

termConn.on('title', (title: string) => {
  console.log('Title:', title);
});

// Write to terminal
termConn.write('ls -la\n');
termConn.write(new Uint8Array([0x03])); // Ctrl+C

// Resize
termConn.resize(120, 40);

// Close
termConn.close();

// Properties
termConn.sessionId;  // string
termConn.pid;        // number
termConn.cwd;        // string
termConn.shell;      // string
termConn.cols;       // number
termConn.rows;       // number
termConn.title;      // string
termConn.status;     // 'running' | 'exited'
termConn.exitCode;   // number | null
```

### Subscribing to Terminal Events

```typescript
const { conn, initialSessions } = await client.terminal.subscribeEvents('ws-1');

conn.on('created', (session) => { ... });
conn.on('destroyed', (sessionId) => { ... });
conn.on('exited', (sessionId, exitCode) => { ... });
conn.on('title_changed', (sessionId, title) => { ... });
conn.on('status_changed', (sessionId, status) => { ... });
conn.on('snapshot', (sessions) => { ... });

conn.close();
```

---

## Full Example: Headless Chat Bot

```typescript
import { Jean2Client } from '@jean2/sdk';

const client = new Jean2Client({
  url: 'http://localhost:3000',
  token: process.env.PROKOPAI_TOKEN,
  clientDescriptor: {
    clientId: 'bot',
    clientType: 'sdk',
    displayName: 'Headless Bot',
    interactionMode: 'headless',
    capabilities: [],
  },
});

// Track assistant responses
let currentText = '';

client.on('connected', async () => {
  console.log('Connected to Jean2 server');

  // Create a session via REST
  const { session } = await client.http.sessions.create({
    workspaceId: 'default',
    title: 'Bot Session',
  });

  // Resume it over WebSocket to receive events
  client.sessions.resume(session.id);

  // Send a message
  client.chat.send(session.id, 'Explain TypeScript generics in one paragraph.');
});

client.on('part.created', (sessionId, part) => {
  if (part.type === 'text') {
    currentText = part.text;
  }
});

client.on('part.append', (sessionId, partId, field, delta) => {
  process.stdout.write(delta);
});

client.on('part.updated', (sessionId, part) => {
  if (part.type === 'tool') {
    console.log(`Tool ${part.name}: ${part.state}`);
  }
});

client.on('ask.request', (sessionId, toolCallId, toolName, ask, requestId) => {
  // Auto-grant all permissions in headless mode
  if (ask.type === 'permission') {
    client.send({
      type: 'ask.response',
      toolCallId,
      response: { type: 'permission', grant: 'session' },
      requestId,
    });
  }
});

client.on('error.connection', (err) => {
  console.error('Connection error:', err);
  process.exit(1);
});

await client.connect();
```

---

## License

Private — part of the Jean2 monorepo.
