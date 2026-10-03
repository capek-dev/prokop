import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, CallToolResultSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { WorkspaceMcpTool } from '@/application/ports/mcp-tools';

/** Forward raw MCP schemas and result blocks without converting them through Zod shapes. */
export function createClaudeWorkspaceMcp(tools: WorkspaceMcpTool[], signal: AbortSignal,
  authorized: () => boolean): McpSdkServerConfigWithInstance | undefined {
  if (!tools.length) return undefined;
  const instance = new McpServer({ name: 'workspace', version: '1.0.0' }, { capabilities: { tools: {} } });
  const available = new Map(tools.map(tool => [tool.name, tool]));
  instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: signal.aborted || !authorized() ? [] : tools.map(tool => ({
      name: tool.name, description: tool.description,
      inputSchema: { ...tool.inputSchema, type: 'object' as const },
    })),
  }));
  instance.server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = available.get(request.params.name);
    if (!tool || signal.aborted || !authorized()) {
      return { content: [{ type: 'text', text: 'MCP tool unavailable' }], isError: true };
    }
    try { return CallToolResultSchema.parse(await tool.execute(request.params.arguments ?? {}, signal, authorized)); }
    catch { return { content: [{ type: 'text', text: 'MCP tool failed or access was disabled' }], isError: true }; }
  });
  return { type: 'sdk', name: 'workspace', instance };
}
