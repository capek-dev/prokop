import * as mcp from '@/mcp';
import type { McpLifecyclePort } from '@/application/ports/mcp';

export function createMcpLifecycle(): McpLifecyclePort {
  return {
    initializeWorkspace: mcp.initializeWorkspace,
    shutdownWorkspace: mcp.shutdownWorkspace,
    connectServer: mcp.connectServer,
    disconnectServer: mcp.disconnectServer,
    getServerStatus: mcp.getServerStatus,
    getAllServerStatus: mcp.getAllServerStatus,
    getTools: mcp.getTools as unknown as McpLifecyclePort['getTools'],
    startAuth: mcp.startAuth,
    finishAuth: mcp.finishAuth,
    getMcpServers: mcp.getMcpServers,
  };
}
