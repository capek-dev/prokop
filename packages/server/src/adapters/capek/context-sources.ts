import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  type AgentSource,
  type InstructionSource,
  type PreconfigSource,
} from '@capekai/core/hosts';
import type { AgentsApplication } from '@/application/agents';
import {
  getDefaultPreconfig,
  getPreconfig,
  listPreconfigs,
  listSubagentPreconfigs,
} from '@/infrastructure/config/preconfig';
import { getGlobalAgentsPath } from '@/infrastructure/runtime/paths';

export const jean2PreconfigSource: PreconfigSource = {
  get: getPreconfig,
  getDefault: getDefaultPreconfig,
  getForAgent: async () => null,
  list: listPreconfigs,
  listSubagents: listSubagentPreconfigs,
};

export const jean2AgentSource: AgentSource = {
  getDirectory: async () => null,
  readMemoryFile: async () => null,
};

export const jean2InstructionSource: InstructionSource = {
  getGlobalPath: getGlobalAgentsPath,
};

export function configureJean2PreconfigSource(agents: AgentsApplication): void {
  jean2PreconfigSource.getForAgent = (id) => agents.getPreconfigOrAgent(id);
  configurePreconfigSource(jean2PreconfigSource);
}

export function configureJean2AgentSource(agents: AgentsApplication): void {
  jean2AgentSource.getDirectory = (id) => agents.getAgentDirectory(id);
  jean2AgentSource.readMemoryFile = (id, filename) => agents.readAgentMemoryFile(id, filename);
  configureAgentSource(jean2AgentSource);
}

export function configureJean2InstructionSource(): void {
  configureInstructionSource(jean2InstructionSource);
}
