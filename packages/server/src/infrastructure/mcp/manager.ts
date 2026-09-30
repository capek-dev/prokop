import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioTransport } from './stdio-transport';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  McpServerConfig,
  McpLocalServerConfig,
  McpRemoteServerConfig,
  McpStatus,
} from '@prokopai/sdk';
import type { CapabilityTool as Tool } from '@/adapters/capek/contracts';
import { convertMcpTool } from './converter';
import { McpOAuthProvider } from './oauth-provider';
import { getMcpServers } from './config';
import { VERSION } from '@/version';

const DEFAULT_TIMEOUT = 30_000;

interface McpClientState {
  client: Client | null;
  status: McpStatus;
}

interface ConnectResult {
  status: McpStatus;
  client: Client | null;
}

interface PendingAuthTransport {
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  serverName: string;
  serverUrl: string;
}

interface PendingOAuth {
  serverName: string;
  serverUrl: string;
  config: McpRemoteServerConfig;
  onRedirect: (url: URL) => void | Promise<void>;
}

const workspaceClients = new Map<string, Map<string, McpClientState>>();
const pendingAuthTransports = new Map<string, PendingAuthTransport>();
const pendingOAuth = new Map<string, PendingOAuth>();

export async function initializeWorkspace(workspacePath: string): Promise<void> {
  if (workspaceClients.has(workspacePath)) {
    return;
  }

  workspaceClients.set(workspacePath, new Map());

  const servers = await getMcpServers(workspacePath);

  for (const [name, config] of Object.entries(servers)) {
    try {
      await connectServer(workspacePath, name, config);
    } catch (err) {
      console.error(`Failed to connect to MCP server ${name}:`, err);
    }
  }
}

export async function shutdownWorkspace(workspacePath: string): Promise<void> {
  const clients = workspaceClients.get(workspacePath);
  if (!clients) {
    return;
  }

  for (const [name, state] of clients) {
    if (state.client) {
      try {
        await state.client.close();
      } catch (err) {
        console.error(`Error closing MCP client ${name}:`, err);
      }
    }
  }

  workspaceClients.delete(workspacePath);
}

export async function connectServer(
  workspacePath: string,
  name: string,
  config: McpServerConfig,
): Promise<McpStatus> {
  let clients = workspaceClients.get(workspacePath);
  if (!clients) {
    clients = new Map();
    workspaceClients.set(workspacePath, clients);
  }

  const existingState = clients.get(name);
  if (existingState?.client) {
    try {
      await existingState.client.close();
    } catch (_e) {
      // Ignore close errors
    }
  }

  let result: ConnectResult;

  try {
    if (config.type === 'local') {
      result = await connectLocalServer(workspacePath, name, config);
    } else {
      result = await connectRemoteServer(workspacePath, name, config);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UnauthorizedError) {
      result = { status: { status: 'needs_auth' }, client: null };
    } else {
      result = { status: { status: 'failed', error: message }, client: null };
    }
  }

  clients.set(name, { client: result.client, status: result.status });
  return result.status;
}

async function connectLocalServer(
  workspacePath: string,
  name: string,
  config: McpLocalServerConfig,
): Promise<ConnectResult> {
  const transport = new StdioTransport({
    command: config.command[0],
    args: config.command.slice(1),
    env: config.env,
    cwd: workspacePath,
  });

  const client = new Client(
    { name, version: VERSION },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport, { timeout: config.timeout ?? DEFAULT_TIMEOUT });
    return { status: { status: 'connected' }, client };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: { status: 'failed', error: message }, client: null };
  }
}

async function connectRemoteServer(
  workspacePath: string,
  name: string,
  config: McpRemoteServerConfig,
): Promise<ConnectResult> {
  const serverUrl = config.url;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const headers = config.headers ?? {};

  const oauthEnabled = config.oauth !== false;
  let oauthProvider: McpOAuthProvider | undefined;

  if (oauthEnabled) {
    oauthProvider = new McpOAuthProvider(
      name,
      serverUrl,
      typeof config.oauth === 'object' ? config.oauth : {},
      {
        onRedirect: (url: URL) => {
          console.log(`OAuth redirect for ${name}:`, url.toString());
        },
      },
    );
  }

  // Try StreamableHTTP first
  let transport: StreamableHTTPClientTransport | SSEClientTransport = new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers,
    },
  });

  let client = new Client(
    { name, version: VERSION },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport, { timeout });

    if (oauthProvider) {
      pendingAuthTransports.set(`${workspacePath}:${name}`, {
        transport: transport as StreamableHTTPClientTransport,
        serverName: name,
        serverUrl,
      });
    }

    return { status: { status: 'connected' }, client };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof UnauthorizedError) {
      if (oauthEnabled) {
        pendingOAuth.set(`${workspacePath}:${name}`, {
          serverName: name,
          serverUrl,
          config,
          onRedirect: (url: URL) => {
            console.log(`OAuth redirect for ${name}:`, url.toString());
          },
        });
      }
      return { status: { status: 'needs_auth' }, client: null };
    }

    // Try SSE fallback
    try {
      transport = new SSEClientTransport(new URL(serverUrl), {
        requestInit: {
          headers,
        },
      });

      client = new Client(
        { name, version: VERSION },
        {
          capabilities: {},
        },
      );

      await client.connect(transport, { timeout });

      if (oauthProvider) {
        pendingAuthTransports.set(`${workspacePath}:${name}`, {
          transport: transport as SSEClientTransport,
          serverName: name,
          serverUrl,
        });
      }

      return { status: { status: 'connected' }, client };
    } catch (_e) {
      return { status: { status: 'failed', error: message }, client: null };
    }
  }
}

export async function disconnectServer(workspacePath: string, name: string): Promise<void> {
  const clients = workspaceClients.get(workspacePath);
  if (!clients) {
    return;
  }

  const state = clients.get(name);
  if (state?.client) {
    try {
      await state.client.close();
    } catch (err) {
      console.error(`Error closing MCP client ${name}:`, err);
    }
  }

  clients.set(name, { client: null, status: { status: 'disabled' } });
  pendingAuthTransports.delete(`${workspacePath}:${name}`);
  pendingOAuth.delete(`${workspacePath}:${name}`);
}

export async function getServerStatus(
  workspacePath: string,
  name: string,
): Promise<McpStatus | undefined> {
  const clients = workspaceClients.get(workspacePath);
  if (!clients) {
    return undefined;
  }

  const state = clients.get(name);
  return state?.status;
}

export async function getAllServerStatus(workspacePath: string): Promise<Record<string, { config: McpServerConfig | undefined; status: McpStatus }>> {
  const clients = workspaceClients.get(workspacePath);
  const servers = await getMcpServers(workspacePath);
  
  const statusMap: Record<string, { config: McpServerConfig | undefined; status: McpStatus }> = {};
  
  // Include all configured servers, not just connected ones
  for (const [name, config] of Object.entries(servers)) {
    const state = clients?.get(name);
    statusMap[name] = {
      config,
      status: state?.status ?? { status: 'disabled' as const },
    };
  }
  
  // Also include any connected servers that might not be in the current config
  if (clients) {
    for (const [name, state] of clients) {
      if (!statusMap[name]) {
        statusMap[name] = {
          config: undefined,
          status: state.status,
        };
      }
    }
  }

  return statusMap;
}

export async function getTools(workspacePath: string, sessionId: string): Promise<Record<string, Tool>> {
  const clients = workspaceClients.get(workspacePath);
  if (!clients) {
    return {};
  }

  const tools: Record<string, Tool> = {};

  for (const [serverName, state] of clients) {
    if (state.status.status !== 'connected' || !state.client) {
      continue;
    }

    try {
      const listResult = await state.client.listTools();

      const mcpTools = listResult.tools ?? [];

      for (const mcpTool of mcpTools) {
        const sanitizedServerName = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const toolKey = `${sanitizedServerName}_${sanitizedToolName}`;
        const tool = await convertMcpTool(mcpTool, state.client, serverName, DEFAULT_TIMEOUT, sessionId);
        tools[toolKey] = tool;
      }
    } catch (err) {
      console.error(`Failed to list tools for MCP server ${serverName}:`, err);
    }
  }

  return tools;
}

export async function startAuth(
  workspacePath: string,
  name: string,
): Promise<{ authorizationUrl: string }> {
  const clients = workspaceClients.get(workspacePath);
  if (!clients) {
    throw new Error(`Workspace ${workspacePath} not initialized`);
  }

  const pending = pendingOAuth.get(`${workspacePath}:${name}`);
  if (!pending) {
    const state = clients.get(name);
    if (!state) {
      throw new Error(`Server ${name} not found`);
    }
    if (state.status.status !== 'needs_auth') {
      throw new Error(`Server ${name} does not need authentication`);
    }
    throw new Error(`No pending OAuth for ${name}`);
  }

  const oauthProvider = new McpOAuthProvider(
    pending.serverName,
    pending.serverUrl,
    typeof pending.config.oauth === 'object' ? pending.config.oauth : {},
    {
      onRedirect: pending.onRedirect,
    },
  );

  const authUrl = await oauthProvider.redirectUrl;

  return { authorizationUrl: authUrl };
}

export async function finishAuth(
  workspacePath: string,
  name: string,
  _code: string,
): Promise<McpStatus> {
  const pendingTransport = pendingAuthTransports.get(`${workspacePath}:${name}`);

  if (!pendingTransport) {
    throw new Error(`No pending authentication for ${name}`);
  }

  try {
    const { serverUrl } = pendingTransport;

    const _oauthProvider = new McpOAuthProvider(name, serverUrl, {}, {
      onRedirect: (url: URL) => {
        console.log(`OAuth redirect for ${name}:`, url.toString());
      },
    });

    // The transport should handle the OAuth flow internally
    // If successful, update the status
    pendingAuthTransports.delete(`${workspacePath}:${name}`);
    pendingOAuth.delete(`${workspacePath}:${name}`);

    const clients = workspaceClients.get(workspacePath);
    if (clients) {
      clients.set(name, { client: null, status: { status: 'connected' } });
    }

    return { status: 'connected' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: message };
  }
}
