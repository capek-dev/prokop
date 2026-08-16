import { join } from 'path';
import type { Agent, Preconfig } from '@jean2/sdk';
import { createAgentsApplication, type AgentsApplication } from '@/application/agents';
import {
  createJean2AgentPreconfigPort,
  createJean2AgentWorkspacePort,
} from '@/adapters/jean2';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import { getDataDir } from '@/paths';

/**
 * S4 compatibility module. The agent promotion, home, and record policy
 * moved to the agents domain and application (`domains/agents`,
 * `application/agents`) over the directory, workspace, and preconfig ports;
 * this module keeps every pre-S4 export identity and forwards to a lazily
 * created application over the current data directory, filesystem adapter,
 * and workspace store. Removed when consumers migrate.
 */

export const AGENTS_DIR = join(getDataDir(), 'agents');

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

export async function getAgentDirectory(id: string): Promise<string | null> {
  return getApplication().getAgentDirectory(id);
}

export function isAgentSync(id: string): boolean {
  return getApplication().isAgentSync(id);
}

export async function isAgent(id: string): Promise<boolean> {
  return getApplication().isAgent(id);
}

export async function listAgents(): Promise<Agent[]> {
  return getApplication().listAgents();
}

export async function getAgent(id: string): Promise<Agent | null> {
  return getApplication().getAgent(id);
}

export async function getPreconfigOrAgent(id: string): Promise<Preconfig | null> {
  return getApplication().getPreconfigOrAgent(id);
}

export async function promotePreconfig(preconfigId: string): Promise<Agent> {
  return getApplication().promotePreconfig(preconfigId);
}

export async function demoteAgent(id: string): Promise<void> {
  return getApplication().demoteAgent(id);
}
