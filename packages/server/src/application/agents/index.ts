import type { Agent, Preconfig } from '@prokopai/sdk';
import type {
  AgentDirectoryPort,
  AgentPreconfigPort,
  AgentWorkspacePort,
} from '../ports/agents';
import {
  AGENT_MEMORY_MEMORY_FILENAME,
  AGENT_MEMORY_USER_FILENAME,
  agentDirectoryPath,
  agentHomeDirectoryPath,
  agentHomeDotJean2DirectoryPath,
  agentHomeWorkspaceSettings,
  agentMemoryFilename,
  agentsRoot,
  agentSkillsDirectoryPath,
  buildAgentHomeWorkspaceInput,
  buildAgentRecord,
  demotionRemovesHomeWorkspace,
  PROMOTION_ERRORS,
  type AgentMemoryTarget,
} from '@/domains/agents';
import { join } from 'path';

export interface AgentsApplicationDeps {
  /** The data directory accessor, injected by the composition root or the
   * compatibility forwarder. */
  dataDir: () => string;
  directory: AgentDirectoryPort;
  workspaces: AgentWorkspacePort;
  preconfigs: AgentPreconfigPort;
}

/**
 * Agents HTTP use cases (S4). Owns the promotion and demotion sequence, the
 * agent record shape, the home directory lookups, and the memory file
 * operations over the injected ports. The pre-S4 route called
 * `agents/storage.ts` and `agents/memory.ts` directly; it now invokes these
 * use cases with the same errors, statuses, and bodies.
 */
export interface AgentsApplication {
  getAgentDirectory(id: string): Promise<string | null>;
  isAgentSync(id: string): boolean;
  isAgent(id: string): Promise<boolean>;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  promotePreconfig(id: string): Promise<Agent>;
  demoteAgent(id: string): Promise<void>;
  readAgentMemoryFile(id: string, filename: 'USER.md' | 'MEMORY.md'): Promise<string | null>;
  writeAgentMemoryFile(id: string, filename: 'USER.md' | 'MEMORY.md', content: string): Promise<void>;
  getAgentMemory(id: string): Promise<{ user: string; memory: string }>;
  updateAgentMemory(id: string, target: AgentMemoryTarget, content: string): Promise<void>;
}

export function createAgentsApplication(deps: AgentsApplicationDeps): AgentsApplication {
  function agentDir(id: string): string {
    return agentDirectoryPath(deps.dataDir(), id);
  }

  async function isAgent(id: string): Promise<boolean> {
    return deps.directory.exists(agentDir(id));
  }

  async function getAgent(id: string): Promise<Agent | null> {
    const dir = agentDir(id);
    if (!deps.directory.exists(dir)) return null;

    const preconfig = await deps.preconfigs.get(id);
    if (!preconfig) return null;

    const createdAt = await deps.directory.statBirthtimeIso(dir);
    return buildAgentRecord(
      preconfig,
      deps.directory.exists(join(dir, 'home')),
      createdAt,
    );
  }

  return {
    async getAgentDirectory(id) {
      const dir = agentDir(id);
      return deps.directory.exists(dir) ? dir : null;
    },

    isAgentSync(id) {
      return deps.directory.exists(agentDir(id));
    },

    isAgent,

    async listAgents() {
      const root = agentsRoot(deps.dataDir());
      if (!deps.directory.exists(root)) return [];
      const entries = await deps.directory.listDirectories(root);
      const agents: Agent[] = [];
      for (const entry of entries) {
        const agent = await getAgent(entry);
        if (agent) agents.push(agent);
      }
      return agents;
    },

    getAgent,

    getPreconfigOrAgent(id) {
      return deps.preconfigs.get(id);
    },

    async promotePreconfig(id) {
      const preconfig = await deps.preconfigs.get(id);
      if (!preconfig) {
        throw new Error(PROMOTION_ERRORS.preconfigNotFound);
      }

      if (await isAgent(id)) {
        throw new Error(PROMOTION_ERRORS.alreadyAgent);
      }

      const layout = {
        agentDir: agentDir(id),
        skillsDir: agentSkillsDirectoryPath(deps.dataDir(), id),
        homeDir: agentHomeDirectoryPath(deps.dataDir(), id),
        homeDotJean2Dir: agentHomeDotJean2DirectoryPath(deps.dataDir(), id),
      };
      await deps.directory.makeDirectories(layout.skillsDir, layout.homeDotJean2Dir);

      const homeWorkspace = buildAgentHomeWorkspaceInput(id, layout.homeDir);
      const workspace = deps.workspaces.create(homeWorkspace);
      deps.workspaces.applySettings(workspace.id, {
        ...workspace.settings,
        ...agentHomeWorkspaceSettings(id),
      });

      const agent = await getAgent(id);
      if (!agent) {
        throw new Error(PROMOTION_ERRORS.failedToCreate);
      }
      return agent;
    },

    async demoteAgent(id) {
      const dir = agentDir(id);
      if (!deps.directory.exists(dir)) return;

      const { homeWorkspaceId } = demotionRemovesHomeWorkspace(id);
      deps.workspaces.delete(homeWorkspaceId);
      await deps.directory.removeRecursive(dir);
    },

    async readAgentMemoryFile(id, filename) {
      const filePath = join(agentDir(id), filename);
      if (!deps.directory.exists(filePath)) return null;
      return deps.directory.readFileOrNull(filePath);
    },

    async writeAgentMemoryFile(id, filename, content) {
      const dir = agentDir(id);
      if (!deps.directory.exists(dir)) {
        await deps.directory.makeDirectories(dir);
      }
      await deps.directory.writeFile(join(dir, filename), content);
    },

    async getAgentMemory(id) {
      return {
        user: (await this.readAgentMemoryFile(id, AGENT_MEMORY_USER_FILENAME)) ?? '',
        memory: (await this.readAgentMemoryFile(id, AGENT_MEMORY_MEMORY_FILENAME)) ?? '',
      };
    },

    async updateAgentMemory(id, target, content) {
      await this.writeAgentMemoryFile(id, agentMemoryFilename(target), content);
    },
  };
}
