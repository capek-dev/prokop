import type { WorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import type { Preconfig } from '@prokopai/sdk/types';
import type { CapabilityTool } from '@/infrastructure/providers/ai-sdk';

interface McpDiscoveryDeps {
  session(id: string): { workspaceId: string; preconfigId?: string | null } | null;
  workspacePath(id: string): string | null;
  preconfig(id: string | null): Promise<Preconfig | null>;
  tools(path: string, sessionId: string, authorized?: () => Promise<boolean>): Promise<Record<string, CapabilityTool>>;
}

/** MCP access is based on the selected agent mode, including for child sessions. */
export function createProkopMcpDiscovery(deps: McpDiscoveryDeps): WorkspaceToolDiscovery {
  return {
    initializeWorkspace: async () => {},
    async discoverTools(_path, sessionId) {
      const session = sessionId ? deps.session(sessionId) : null;
      if (!session || !sessionId) return {};
      const path = deps.workspacePath(session.workspaceId);
      if (!path) return {};
      const preconfigId = session.preconfigId ?? null;
      const authorized = async (): Promise<boolean> => {
        const current = deps.session(sessionId);
        if (!current || current.workspaceId !== session.workspaceId
          || (current.preconfigId ?? null) !== preconfigId
          || deps.workspacePath(current.workspaceId) !== path) return false;
        const preconfig = await deps.preconfig(preconfigId);
        return !!preconfig && (preconfig.mode === undefined || preconfig.mode === 'primary' || preconfig.mode === 'both');
      };
      if (!await authorized()) return {};
      return deps.tools(path, sessionId, authorized);
    },
  };
}
