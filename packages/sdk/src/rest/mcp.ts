import type { HttpClient } from '../transport/http';
import type { McpServerConfig, McpToolInfo } from '../shared-types/mcp';
import type {
  GetMcpStatusResponse,
  ConnectMcpServerResponse,
  DisconnectMcpServerResponse,
  StartMcpAuthResponse,
  FinishMcpAuthResponse,
} from '../types/rest-responses';

interface GetMcpStatusOptions {
  signal?: AbortSignal;
}

interface ConnectMcpServerOptions {
  signal?: AbortSignal;
}

interface DisconnectMcpServerOptions {
  signal?: AbortSignal;
}

interface StartMcpAuthOptions {
  signal?: AbortSignal;
}

interface FinishMcpAuthOptions {
  signal?: AbortSignal;
  state: string;
}

function mcpPath(workspaceId: string | null): string {
  return workspaceId === null ? '/mcp' : `/workspaces/${encodeURIComponent(workspaceId)}/mcp`;
}

/** Pass null as workspaceId to manage global MCP connections. */
export class McpRestNamespace {
  constructor(private http: HttpClient) {}

  async save(workspaceId: string | null, name: string, config: McpServerConfig): Promise<{ success: boolean }> {
    return this.http.post(`${mcpPath(workspaceId)}/servers`, { name, config });
  }

  async remove(workspaceId: string | null, name: string): Promise<{ success: boolean }> {
    return this.http.post(`${mcpPath(workspaceId)}/remove`, { name });
  }

  async getTools(workspaceId: string | null, name: string, options?: { signal?: AbortSignal }): Promise<{ tools: McpToolInfo[] }> {
    return this.http.get(`${mcpPath(workspaceId)}/tools?name=${encodeURIComponent(name)}`, options);
  }

  async setToolEnabled(workspaceId: string | null, name: string, toolName: string, enabled: boolean): Promise<{ success: boolean }> {
    return this.http.post(`${mcpPath(workspaceId)}/tools`, { name, toolName, enabled });
  }

  /**
   * GET /api/workspaces/:id/mcp/status - Get MCP server status for a workspace
   */
  async getStatus(
    workspaceId: string | null,
    options?: GetMcpStatusOptions,
  ): Promise<GetMcpStatusResponse> {
    return this.http.get(
      `${mcpPath(workspaceId)}/status`,
      { signal: options?.signal },
    );
  }

  /**
   * POST /api/workspaces/:id/mcp/connect - Connect to an MCP server
   */
  async connect(
    workspaceId: string | null,
    name: string,
    options?: ConnectMcpServerOptions,
  ): Promise<ConnectMcpServerResponse> {
    const { signal } = options ?? {};
    return this.http.post(
      `${mcpPath(workspaceId)}/connect`,
      { name },
      { signal },
    );
  }

  /**
   * POST /api/workspaces/:id/mcp/disconnect - Disconnect from an MCP server
   */
  async disconnect(
    workspaceId: string | null,
    name: string,
    options?: DisconnectMcpServerOptions,
  ): Promise<DisconnectMcpServerResponse> {
    const { signal } = options ?? {};
    return this.http.post(
      `${mcpPath(workspaceId)}/disconnect`,
      { name },
      { signal },
    );
  }

  /**
   * POST /api/workspaces/:id/mcp/auth - Start OAuth flow for a server
   */
  async startAuth(
    workspaceId: string | null,
    name: string,
    options?: StartMcpAuthOptions,
  ): Promise<StartMcpAuthResponse> {
    const { signal } = options ?? {};
    return this.http.post(
      `${mcpPath(workspaceId)}/auth`,
      { name },
      { signal },
    );
  }

  /**
   * POST /api/workspaces/:id/mcp/auth/callback - Handle OAuth callback
   */
  async finishAuth(
    workspaceId: string | null,
    name: string,
    code: string,
    options: FinishMcpAuthOptions,
  ): Promise<FinishMcpAuthResponse> {
    const { signal } = options ?? {};
    return this.http.post(
      `${mcpPath(workspaceId)}/auth/callback`,
      { name, code, state: options.state },
      { signal },
    );
  }
}
