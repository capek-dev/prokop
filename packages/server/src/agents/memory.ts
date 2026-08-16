import { createAgentsApplication, type AgentsApplication } from '@/application/agents';
import {
  createJean2AgentPreconfigPort,
  createJean2AgentWorkspacePort,
} from '@/adapters/jean2';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@/paths';

/**
 * S4 compatibility module. The agent memory file policy moved to the agents
 * application (`application/agents`) over the directory port; this module
 * keeps every pre-S4 export identity. Removed when consumers migrate.
 */

let application: AgentsApplication | null = null;

function getApplication(): AgentsApplication {
  if (!application) {
    application = createAgentsApplication({
      dataDir: () => getDataDir(),
      directory: createAgentDirectoryPort(),
      workspaces: createJean2AgentWorkspacePort(),
      preconfigs: createJean2AgentPreconfigPort(),
    });
  }
  return application;
}

export async function readAgentMemoryFile(
  agentId: string,
  filename: 'USER.md' | 'MEMORY.md',
): Promise<string | null> {
  return getApplication().readAgentMemoryFile(agentId, filename);
}

export async function writeAgentMemoryFile(
  agentId: string,
  filename: 'USER.md' | 'MEMORY.md',
  content: string,
): Promise<void> {
  return getApplication().writeAgentMemoryFile(agentId, filename, content);
}

export async function getAgentMemory(agentId: string): Promise<{ user: string; memory: string }> {
  return getApplication().getAgentMemory(agentId);
}

export async function updateAgentMemory(
  agentId: string,
  target: 'user' | 'memory',
  content: string,
): Promise<void> {
  return getApplication().updateAgentMemory(agentId, target, content);
}
