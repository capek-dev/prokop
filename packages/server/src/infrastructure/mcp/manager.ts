import { createHash } from 'node:crypto';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { CallToolResultSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerConfig, McpRemoteServerConfig, McpStatus, McpToolInfo } from '@prokopai/sdk';
import type { WorkspaceMcpTool } from '@/application/ports/mcp-tools';
import type { McpLifecyclePort } from '@/application/ports/mcp';
import { BadRequestError, NotFoundError } from '@/application/http-errors';
import { getDataDir } from '@/infrastructure/runtime/paths';
import { VERSION } from '@/version';
import { StdioTransport } from './stdio-transport';
import { McpOAuthProvider } from './oauth-provider';
import { getMcpServers, updateMcpConfig } from './config';
import { removeAuth } from './auth';

const TIMEOUT = 30_000;
interface State { client: Client | null; status: McpStatus; config: McpServerConfig }
interface PendingAuth {
  path: string | null; name: string; config: McpRemoteServerConfig;
  provider: McpOAuthProvider; expiresAt: number;
}
export interface McpManager extends Omit<McpLifecyclePort, 'getTools' | 'getMcpServers'> {
  getWorkspaceTools(path: string): Promise<WorkspaceMcpTool[]>;
  setMcpChangeListener(listener: (path: string | null) => void): void;
}

/** One host owns its connections; tests can supply HTTP without replacing global fetch. */
export function createMcpManager(fetchMcp: FetchLike = fetch): McpManager {
  const workspaces = new Map<string | null, Map<string, State>>();
  const operations = new Map<string | null, Promise<unknown>>();
  const pendingAuth = new Map<string, PendingAuth>();
  let onChange: (path: string | null) => void = () => {};
  function setMcpChangeListener(listener: (path: string | null) => void): void { onChange = listener; }
  function credentialKey(path: string | null, name: string, url: string): string {
    return createHash('sha256').update(JSON.stringify([path, name, url])).digest('hex');
  }
  function transportIdentity(config: McpServerConfig): string {
    const pairs = (values: Record<string, string> = {}) => Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
    if (config.type === 'local') return JSON.stringify(['local', config.command, pairs(config.env), config.timeout ?? TIMEOUT]);
    const oauth = typeof config.oauth === 'object' ? config.oauth : {};
    return JSON.stringify(['remote', config.url, pairs(config.headers), config.timeout ?? TIMEOUT,
      config.oauth === false ? false : [oauth.clientId ?? '', oauth.clientSecret ?? '', oauth.scope ?? '']]);
  }
  async function serialized<T>(path: string | null, action: () => Promise<T>): Promise<T> {
    const next = (operations.get(path) ?? Promise.resolve()).catch(() => {}).then(action);
    operations.set(path, next);
    try { return await next; } finally { if (operations.get(path) === next) operations.delete(path); }
  }
  function cancelAuth(path: string | null, name: string): void {
    for (const [state, pending] of pendingAuth) {
      if (pending.expiresAt < Date.now() || pending.path === path && pending.name === name) pendingAuth.delete(state);
    }
  }
  async function disconnect(path: string | null, name: string): Promise<void> {
    cancelAuth(path, name);
    const state = workspaces.get(path)?.get(name);
    if (!state) return;
    const client = state.client;
    state.client = null;
    state.status = { status: 'disabled' };
    await client?.close().catch(() => {});
  }
  function provider(path: string | null, name: string, config: McpRemoteServerConfig,
    redirectUrl = 'http://127.0.0.1/api/mcp/oauth/callback', state = crypto.randomUUID(),
    onRedirect?: (url: URL) => void): McpOAuthProvider {
    return new McpOAuthProvider(credentialKey(path, name, config.url), config.url,
      typeof config.oauth === 'object' ? config.oauth : {}, { redirectUrl, state, interactive: !!onRedirect,
        onRedirect: onRedirect ?? (() => { throw new UnauthorizedError('MCP sign-in required'); }) });
  }
  async function connect(path: string | null, name: string, config: McpServerConfig): Promise<McpStatus> {
    await disconnect(path, name);
    let clients = workspaces.get(path);
    if (!clients) { clients = new Map(); workspaces.set(path, clients); }
    const state: State = { client: null, status: { status: 'disabled' }, config };
    clients.set(name, state);
    if (config.enabled === false) return state.status;
    const timeout = config.timeout ?? TIMEOUT;
    const transports = config.type === 'local'
      ? [(_signal: AbortSignal) => new StdioTransport({ command: config.command[0]!, args: config.command.slice(1),
        env: config.env, cwd: path ?? getDataDir(), stderr: 'ignore' })]
      : [
        (signal: AbortSignal) => new StreamableHTTPClientTransport(new URL(config.url), {
          fetch: (url, init) => fetchMcp(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
          requestInit: { headers: config.headers }, authProvider: config.oauth === false ? undefined : provider(path, name, config) }),
        (signal: AbortSignal) => new SSEClientTransport(new URL(config.url), {
          fetch: (url, init) => fetchMcp(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) }),
          requestInit: { headers: config.headers }, authProvider: config.oauth === false ? undefined : provider(path, name, config) }),
      ];
    for (const createTransport of transports) {
      const client = new Client({ name: 'prokop', version: VERSION }, { capabilities: {} });
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(createTransport(controller.signal), { timeout }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('MCP connection timed out')); }, timeout);
          }),
        ]);
        state.client = client;
        state.status = { status: 'connected' };
        client.onclose = () => {
          if (state.client !== client) return;
          state.client = null;
          state.status = { status: 'failed', error: 'Connection closed. Reconnect to try again.' };
          onChange(path);
        };
        break;
      } catch (error: unknown) {
        await client.close().catch(() => {});
        if (error instanceof UnauthorizedError) { state.status = { status: 'needs_auth' }; break; }
        // Provider/server error bodies can contain credentials. Keep public errors bounded and generic.
        state.status = { status: 'failed', error: 'Unable to connect. Check the address, command and credentials.' };
      } finally {
        clearTimeout(timer);
      }
    }
    onChange(path);
    return state.status;
  }
  async function initializeWorkspace(path: string | null): Promise<void> {
    await serialized(path, async () => {
      const configs = await getMcpServers(path);
      for (const name of workspaces.get(path)?.keys() ?? []) {
        if (!Object.hasOwn(configs, name)) { await disconnect(path, name); workspaces.get(path)?.delete(name); }
      }
      for (const [name, config] of Object.entries(configs)) {
        const state = workspaces.get(path)?.get(name);
        if (!state || transportIdentity(state.config) !== transportIdentity(config)
          || (state.config.enabled !== false) !== (config.enabled !== false)) await connect(path, name, config);
      }
    });
  }
  async function shutdownWorkspace(path: string | null): Promise<void> {
    await serialized(path, async () => {
      for (const name of workspaces.get(path)?.keys() ?? []) await disconnect(path, name);
      workspaces.delete(path);
    });
  }
  async function connectServer(path: string | null, name: string, config: McpServerConfig): Promise<McpStatus> {
    return serialized(path, () => connect(path, name, config));
  }
  async function disconnectServer(path: string | null, name: string): Promise<void> {
    await serialized(path, () => disconnect(path, name)); onChange(path);
  }
  async function saveServer(path: string | null, name: string, config: McpServerConfig): Promise<void> {
    await serialized(path, async () => {
      const old = (await getMcpServers(path))[name];
      await updateMcpConfig(path, name, config);
      if (old?.type === 'remote' && transportIdentity(old) !== transportIdentity(config)) {
        await removeAuth(credentialKey(path, name, old.url));
      }
      const state = workspaces.get(path)?.get(name);
      if (!state || transportIdentity(state.config) !== transportIdentity(config)
        || (state.config.enabled !== false) !== (config.enabled !== false)) await connect(path, name, config);
    });
    onChange(path);
  }
  async function removeServer(path: string | null, name: string): Promise<void> {
    await serialized(path, async () => {
      const old = (await getMcpServers(path))[name];
      await updateMcpConfig(path, name, null);
      await disconnect(path, name);
      workspaces.get(path)?.delete(name);
      if (old?.type === 'remote') await removeAuth(credentialKey(path, name, old.url));
    });
    onChange(path);
  }
  async function setToolEnabled(path: string | null, name: string, toolName: string, enabled: boolean): Promise<void> {
    await serialized(path, async () => {
      const config = (await getMcpServers(path))[name];
      if (!config) throw new NotFoundError('MCP server not found');
      const disabled = new Set(config.disabledTools);
      if (enabled) disabled.delete(toolName); else disabled.add(toolName);
      await updateMcpConfig(path, name, { ...config, disabledTools: [...disabled] });
    });
    onChange(path);
  }
  async function getServerStatus(path: string | null, name: string): Promise<McpStatus | undefined> {
    return workspaces.get(path)?.get(name)?.status;
  }
  async function getAllServerStatus(path: string | null): Promise<Record<string, { config: McpServerConfig; status: McpStatus }>> {
    const configs = await getMcpServers(path);
    return Object.fromEntries(Object.entries(configs).map(([name, config]) => [name, {
      config, status: config.enabled === false ? { status: 'disabled' } : workspaces.get(path)?.get(name)?.status ?? { status: 'disabled' },
    }]));
  }
  async function listTools(state: State): Promise<Tool[]> {
    if (!state.client || state.status.status !== 'connected') return [];
    const tools: Tool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await state.client.listTools(cursor ? { cursor } : {}, { timeout: state.config.timeout ?? TIMEOUT });
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor) || tools.length > 10_000) throw new Error('Invalid MCP tool pagination');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }
  async function getServerTools(path: string | null, name: string): Promise<McpToolInfo[]> {
    await initializeWorkspace(path);
    const config = (await getMcpServers(path))[name];
    if (!config) throw new NotFoundError('MCP server not found');
    const state = workspaces.get(path)?.get(name);
    let tools: Tool[];
    try { tools = state ? await listTools(state) : []; }
    catch { throw new Error('Unable to list MCP tools. Reconnect and try again.'); }
    return tools.map(tool => ({ name: tool.name, description: tool.description,
      enabled: !config.disabledTools?.includes(tool.name) }));
  }
  async function getScopeTools(path: string | null): Promise<WorkspaceMcpTool[]> {
    await initializeWorkspace(path);
    const configs = await getMcpServers(path);
    const result: WorkspaceMcpTool[] = [];
    for (const [name, state] of workspaces.get(path) ?? []) {
      const config = configs[name];
      const client = state.client;
      if (!config || config.enabled === false || !client) continue;
      let definitions: Tool[];
      try { definitions = await listTools(state); } catch { continue; }
      for (const definition of definitions) {
        if (config.disabledTools?.includes(definition.name)) continue;
        // Stable, bounded identifiers avoid collisions after name sanitization.
        const suffix = createHash('sha256').update(JSON.stringify(path === null ? ['global', name, definition.name] : [name, definition.name])).digest('hex').slice(0, 16);
        const key = 'mcp_' + definition.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) + '_' + suffix;
        result.push({ name: key, serverName: name, toolName: definition.name,
          description: definition.description ?? 'Tool from ' + name, inputSchema: definition.inputSchema,
          async execute(input, signal, authorized) {
            signal?.throwIfAborted();
            const current = (await getMcpServers(path))[name];
            if (!current || current.enabled === false || current.disabledTools?.includes(definition.name)
              || transportIdentity(current) !== transportIdentity(config)
              || workspaces.get(path)?.get(name)?.client !== client) throw new Error('MCP tool is disabled or its connection changed');
            if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid MCP arguments');
            if (authorized && !authorized()) throw new Error('MCP tool unavailable');
            signal?.throwIfAborted();
            return CallToolResultSchema.parse(await client.callTool({ name: definition.name, arguments: input }, CallToolResultSchema,
              { timeout: current.timeout ?? TIMEOUT, signal }));
          } });
      }
    }
    return result;
  }
  async function getWorkspaceTools(path: string): Promise<WorkspaceMcpTool[]> {
    const [globalTools, workspaceTools, workspaceServers] = await Promise.all([
      getScopeTools(null), getScopeTools(path), getMcpServers(path),
    ]);
    const inherited = globalTools.filter(tool => !Object.hasOwn(workspaceServers, tool.serverName));
    return [...inherited.map(tool => ({
      ...tool,
      async execute(input: Record<string, unknown>, signal?: AbortSignal, authorized?: () => boolean) {
        // A newly added workspace override also revokes handles already exposed to a turn.
        if (Object.hasOwn(await getMcpServers(path), tool.serverName)) {
          throw new Error('Global MCP server is overridden by this workspace');
        }
        return tool.execute(input, signal, authorized);
      },
    })), ...workspaceTools];
  }
  async function startAuth(path: string | null, name: string, redirectUrl: string): Promise<{ authorizationUrl: string }> {
    return serialized(path, async () => {
      const config = (await getMcpServers(path))[name];
      if (!config || config.type !== 'remote' || config.oauth === false || config.enabled === false) {
        throw new BadRequestError('Enable a remote OAuth server before signing in');
      }
      await disconnect(path, name);
      let clients = workspaces.get(path);
      if (!clients) { clients = new Map(); workspaces.set(path, clients); }
      clients.set(name, { client: null, config, status: { status: 'needs_auth' } });
      onChange(path);
      const state = crypto.randomUUID();
      let authorizationUrl: string | undefined;
      const oauth = provider(path, name, config, redirectUrl, state, url => { authorizationUrl = url.toString(); });
      await oauth.invalidateCredentials('tokens');
      try {
        await auth(oauth, { serverUrl: config.url, scope: typeof config.oauth === 'object' ? config.oauth.scope : undefined,
          fetchFn: (url, init) => fetchMcp(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }) });
      } catch { throw new BadRequestError('Unable to start OAuth. Check whether this server requires a registered client ID.'); }
      if (!authorizationUrl) throw new BadRequestError('The server did not provide an authorization URL');
      pendingAuth.set(state, { path, name, config, provider: oauth, expiresAt: Date.now() + 10 * 60_000 });
      return { authorizationUrl };
    });
  }
  async function finishAuth(state: string, code: string, expected?: { path: string | null; name: string }): Promise<{ path: string | null; status: McpStatus }> {
    const pending = pendingAuth.get(state);
    if (pending && expected && (pending.path !== expected.path || pending.name !== expected.name)) {
      throw new BadRequestError('OAuth request does not belong to this scope and server');
    }
    pendingAuth.delete(state);
    if (!pending || pending.expiresAt < Date.now() || !code) throw new BadRequestError('OAuth request expired or is invalid. Start sign-in again.');
    return serialized(pending.path, async () => {
      const { path, name, config, provider: oauth } = pending;
      const current = (await getMcpServers(path))[name];
      if (!current || current.enabled === false || transportIdentity(current) !== transportIdentity(config)) {
        throw new BadRequestError('MCP configuration changed. Start sign-in again.');
      }
      try {
        const result = await auth(oauth, { serverUrl: config.url, authorizationCode: code,
          fetchFn: (url, init) => fetchMcp(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }) });
        if (result !== 'AUTHORIZED') throw new Error('Authorization incomplete');
      } catch { throw new BadRequestError('OAuth token exchange failed. Start sign-in again.'); }
      const status = await connect(path, name, current);
      onChange(path);
      return { path, status };
    });
  }
  return { setMcpChangeListener, initializeWorkspace, shutdownWorkspace, connectServer, disconnectServer, saveServer, removeServer, setToolEnabled, getServerStatus, getAllServerStatus, getServerTools, getWorkspaceTools, startAuth, finishAuth };
}

export const { setMcpChangeListener, initializeWorkspace, shutdownWorkspace, connectServer, disconnectServer, saveServer, removeServer, setToolEnabled, getServerStatus, getAllServerStatus, getServerTools, getWorkspaceTools, startAuth, finishAuth } = createMcpManager();
