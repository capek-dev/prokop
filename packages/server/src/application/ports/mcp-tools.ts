/** Host-owned MCP tools, independent of any agent SDK. */
export interface WorkspaceMcpTool {
  name: string;
  serverName: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, signal?: AbortSignal, authorized?: () => boolean | Promise<boolean>): Promise<WorkspaceMcpResult>;
}
export interface WorkspaceMcpResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
export interface WorkspaceMcpToolsPort {
  /** Effective global and workspace tools, with workspace server names taking precedence. */
  tools(workspacePath: string, sessionId?: string): Promise<WorkspaceMcpTool[]>;
}
