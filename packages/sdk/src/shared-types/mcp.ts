/**
 * MCP Server Configuration Types
 * Used for configuring MCP servers in workspace .prokopai/mcp.json (legacy: .jean2)
 */

export type McpServerType = 'local' | 'remote';

export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

export interface McpLocalServerConfig {
  type: 'local';
  command: string[];
  env?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

export interface McpRemoteServerConfig {
  type: 'remote';
  url: string;
  oauth?: boolean | McpOAuthConfig;
  headers?: Record<string, string>;
  timeout?: number;
  enabled?: boolean;
}

export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig;

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export type McpStatus =
  | { status: 'connected' }
  | { status: 'disabled' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string };

export interface McpServerInfo {
  name: string;
  config: McpServerConfig;
  status: McpStatus;
  toolCount?: number;
}
