import { join, resolve } from 'node:path';
import type { Workspace } from '@prokopai/sdk';
import type { AgentsApplication } from '@/application/agents';
import { agentHomeWorkspaceId } from '@/domains/agents/home';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';

/** Matches foreground memory and skill tools, including legacy workspace memory.
 * Personal memory lives in the agent directory, not home/.prokopai. */
export function createLearningDirectoryResolver(agents: Pick<AgentsApplication, 'getAgentDirectory'>):
  (workspace: Workspace) => Promise<{ memoryDirectory: string; skillsDirectory: string }> {
  return async workspace => {
    if (workspace.settings.isAgentHome) {
      const id = workspace.settings.agentId;
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || workspace.id !== agentHomeWorkspaceId(id)) {
        throw new Error('Learning agent-home identity is invalid');
      }
      const directory = await agents.getAgentDirectory(id);
      if (!directory || resolve(workspace.path) !== resolve(directory, 'home')) {
        throw new Error('Learning agent home is unavailable');
      }
      return { memoryDirectory: resolve(directory), skillsDirectory: resolve(directory, 'skills') };
    }
    return {
      memoryDirectory: resolve(resolveWorkspaceMemoryDir(workspace.path)),
      skillsDirectory: resolve(join(workspace.path, '.agents', 'skills')),
    };
  };
}
