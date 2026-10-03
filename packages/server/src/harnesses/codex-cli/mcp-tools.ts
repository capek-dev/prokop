import type { WorkspaceMcpToolsPort } from '@/application/ports/mcp-tools';
import { codexObject } from './app-server';
import type { CodexMemoryCallResult } from './memory-tools';

const fail = (text: string): CodexMemoryCallResult => ({ success: false, contentItems: [{ type: 'inputText', text }] });
/** Stable entrypoints let a new Codex thread discover future workspace configuration changes. */
export function createCodexMcpTools(options: {
  bridge: WorkspaceMcpToolsPort; path: string;
  authorized(turnId: string): boolean;
}): { definitions: Array<{ type: 'function'; name: string; description: string; inputSchema: Record<string, unknown> }>;
  call(raw: unknown): Promise<CodexMemoryCallResult> } {
  const seen = new Set<string>();
  return {
    definitions: [
      { type: 'function', name: 'mcp_list_tools', description: 'List allowed global and workspace MCP tools with their server, name, description and JSON input schema. Call before mcp_call_tool.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
      { type: 'function', name: 'mcp_call_tool', description: 'Call an allowed global or workspace MCP tool. Get the exact tool ID and argument schema from mcp_list_tools first.',
        inputSchema: { type: 'object', properties: { tool: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } },
          required: ['tool', 'arguments'], additionalProperties: false } },
    ],
    async call(raw) {
      const request = codexObject(raw);
      if (!request || request.namespace !== null || typeof request.turnId !== 'string'
        || !options.authorized(request.turnId) || typeof request.callId !== 'string'
        || !request.callId || request.callId.length > 256
        || !['mcp_list_tools', 'mcp_call_tool'].includes(String(request.tool))) return fail('MCP tool unavailable');
      if (seen.has(request.callId)) return fail('Duplicate MCP call');
      seen.add(request.callId);
      const input = codexObject(request.arguments);
      if (!input || JSON.stringify(input).length > 256_000) return fail('Invalid MCP arguments');
      try {
        const tools = await options.bridge.tools(options.path);
        if (!options.authorized(request.turnId)) return fail('MCP tool unavailable');
        if (request.tool === 'mcp_list_tools') {
          if (Object.keys(input).length) return fail('Invalid MCP arguments');
          return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(tools.map(
            ({ execute: _execute, ...definition }) => definition)) }] };
        }
        if (typeof input.tool !== 'string' || !codexObject(input.arguments)
          || Object.keys(input).some(key => key !== 'tool' && key !== 'arguments')) return fail('Invalid MCP arguments');
        const tool = tools.find(tool => tool.name === input.tool);
        if (!tool) return fail('MCP tool is unavailable or disabled');
        const turnId = request.turnId;
        const result = await tool.execute(input.arguments as Record<string, unknown>, undefined, () => options.authorized(turnId));
        return { success: !result.isError, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
      } catch { return fail('MCP tool failed or access was disabled'); }
    },
  };
}
