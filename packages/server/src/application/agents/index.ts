import type { Agent, Preconfig } from '@prokopai/sdk';
import type {
  AgentDirectoryPort,
  AgentPreconfigPort,
  AgentWorkspacePort,
} from '@/application/ports/agents';
import {
  AGENT_MEMORY_MEMORY_FILENAME,
  AGENT_MEMORY_USER_FILENAME,
  agentDirectoryPath,
  agentHomeDirectoryPath,
  agentHomeDotProkopDirectoryPath,
  agentHomeWorkspaceId,
  agentHomeWorkspaceSettings,
  agentMemoryFilename,
  agentsRoot,
  agentSkillsDirectoryPath,
  buildAgentHomeWorkspaceInput,
  buildAgentRecord,
  demotionRemovesHomeWorkspace,
  shouldMaterializeAgent,
  PROMOTION_ERRORS,
  type AgentMemoryTarget,
} from '@/domains/agents';
import { join } from 'path';
import matter from 'gray-matter';

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
  /** Idempotently materializes the agent directory, memory files, skills
   * directory, and home workspace for a primary/both preconfig. Returns the
   * agent record, or null when the preconfig is missing or subagent-only.
   * Never destructive: existing directories, files, and workspace settings
   * are preserved. */
  ensureAgentMaterialized(id: string): Promise<Agent | null>;
  /** Materializes every primary/both preconfig. Returns the materialized
   * agent ids. Used by the startup scan so existing installs gain agents
   * without any user action. */
  ensureAgentsMaterialized(): Promise<string[]>;
  promotePreconfig(id: string): Promise<Agent>;
  demoteAgent(id: string): Promise<void>;
  readAgentMemoryFile(id: string, filename: 'USER.md' | 'MEMORY.md'): Promise<string | null>;
  writeAgentMemoryFile(id: string, filename: 'USER.md' | 'MEMORY.md', content: string): Promise<void>;
  getAgentMemory(id: string): Promise<{ user: string; memory: string }>;
  updateAgentMemory(id: string, target: AgentMemoryTarget, content: string): Promise<void>;
  /** Read-only listing of the agent's personal skills (name + description)
   * from `<agents/<id>/skills/<name>/SKILL.md` frontmatter. The runtime
   * `agent_skill_manage` tool stays the write path. */
  listAgentSkills(id: string): Promise<Array<{ name: string; description: string }>>;
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

    async ensureAgentMaterialized(id) {
      const preconfig = await deps.preconfigs.get(id);
      if (!preconfig) return null;
      if (!shouldMaterializeAgent(preconfig)) return null;

      const layout = {
        agentDir: agentDir(id),
        skillsDir: agentSkillsDirectoryPath(deps.dataDir(), id),
        homeDir: agentHomeDirectoryPath(deps.dataDir(), id),
        homeDotProkopDir: agentHomeDotProkopDirectoryPath(deps.dataDir(), id),
      };
      if (!deps.directory.exists(layout.agentDir)) {
        await deps.directory.makeDirectories(layout.skillsDir, layout.homeDotProkopDir);
      }

      // Create-or-heal the home workspace row; never clobber stored settings.
      const homeId = agentHomeWorkspaceId(id);
      const existing = deps.workspaces.get(homeId);
      if (!existing) {
        const workspace = deps.workspaces.create(
          buildAgentHomeWorkspaceInput(id, layout.homeDir),
        );
        deps.workspaces.applySettings(workspace.id, {
          ...workspace.settings,
          ...agentHomeWorkspaceSettings(id),
        });
      } else {
        deps.workspaces.applySettings(existing.id, {
          ...existing.settings,
          isAgentHome: true,
          agentId: id,
        });
      }

      return getAgent(id);
    },

    async ensureAgentsMaterialized() {
      const preconfigs = await deps.preconfigs.list();
      const materialized: string[] = [];
      for (const preconfig of preconfigs) {
        if (!shouldMaterializeAgent(preconfig)) continue;
        const agent = await this.ensureAgentMaterialized(preconfig.id);
        if (agent) materialized.push(agent.id);
      }
      return materialized;
    },

    async promotePreconfig(id) {
      const preconfig = await deps.preconfigs.get(id);
      if (!preconfig) {
        throw new Error(PROMOTION_ERRORS.preconfigNotFound);
      }
      if (!shouldMaterializeAgent(preconfig)) {
        throw new Error(PROMOTION_ERRORS.subagentOnlyNotPromotable);
      }

      // Promotion is idempotent: materializing an existing agent returns it.
      const agent = await this.ensureAgentMaterialized(id);
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

    async listAgentSkills(id) {
      const skillsDir = agentSkillsDirectoryPath(deps.dataDir(), id);
      if (!deps.directory.exists(skillsDir)) return [];
      const entries = await deps.directory.listDirectories(skillsDir);
      const skills: Array<{ name: string; description: string }> = [];
      for (const entry of entries) {
        const content = await deps.directory.readFileOrNull(join(skillsDir, entry, 'SKILL.md'));
        if (content === null) continue;
        try {
          const { data } = matter(content);
          skills.push({
            name: typeof data.name === 'string' && data.name ? data.name : entry,
            description: typeof data.description === 'string' ? data.description : '',
          });
        } catch {
          skills.push({ name: entry, description: '' });
        }
      }
      return skills;
    },
  };
}
