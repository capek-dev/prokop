import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  type AgentSource,
  type InstructionSource,
  type PreconfigSource,
} from '@capekai/core/internal/hosts';
import { getAgentDirectory, getPreconfigOrAgent } from '@/agents/storage';
import { readAgentMemoryFile } from '@/agents/memory';
import {
  getDefaultPreconfig,
  getPreconfig,
  listPreconfigs,
  listSubagentPreconfigs,
} from '@/core/preconfig';
import { getGlobalAgentsPath } from '@/paths';

export const jean2PreconfigSource: PreconfigSource = {
  get: getPreconfig,
  getDefault: getDefaultPreconfig,
  getForAgent: getPreconfigOrAgent,
  list: listPreconfigs,
  listSubagents: listSubagentPreconfigs,
};

export const jean2AgentSource: AgentSource = {
  getDirectory: getAgentDirectory,
  readMemoryFile: readAgentMemoryFile,
};

export const jean2InstructionSource: InstructionSource = {
  getGlobalPath: getGlobalAgentsPath,
};

export function configureJean2PreconfigSource(): void {
  configurePreconfigSource(jean2PreconfigSource);
}

export function configureJean2AgentSource(): void {
  configureAgentSource(jean2AgentSource);
}

export function configureJean2InstructionSource(): void {
  configureInstructionSource(jean2InstructionSource);
}
