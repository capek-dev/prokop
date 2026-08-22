import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  type AgentSource,
  type InstructionSource,
  type PreconfigSource,
} from '@capekai/core/hosts';
import { RETRIEVE_TOOL_OUTPUT_NAME } from '@capekai/core/tools';
import type { Preconfig } from '@capekai/types';
import type { AgentsApplication } from '@/application/agents';
import {
  getDefaultPreconfig,
  getPreconfig,
  listPreconfigs,
  listSubagentPreconfigs,
} from '@/infrastructure/config/preconfig';
import { getGlobalAgentsPath } from '@/infrastructure/runtime/paths';

/** The retrieval tool ships as a contributed tool through the
 * tool-output policy plugin, so under the scoped resolver it reaches
 * the model only when listed in preconfig.tools. Jean2 preconfigs are
 * user-authored and never list it; the facade path derives tool lists
 * from the composed scope, which always includes it. This append
 * mirrors the facade semantics for every preconfig the server feeds
 * into capek. */
function withRetrievalTool(preconfig: Preconfig | null): Preconfig | null {
  if (!preconfig) return preconfig;
  if (preconfig.tools?.includes(RETRIEVE_TOOL_OUTPUT_NAME)) return preconfig;
  return { ...preconfig, tools: [...(preconfig.tools ?? []), RETRIEVE_TOOL_OUTPUT_NAME] };
}

export const jean2PreconfigSource: PreconfigSource = {
  get: async (id) => withRetrievalTool(await getPreconfig(id)),
  getDefault: async () => withRetrievalTool(await getDefaultPreconfig()),
  getForAgent: async () => null,
  list: async () => (await listPreconfigs()).map((preconfig) => withRetrievalTool(preconfig)!),
  listSubagents: async () => (await listSubagentPreconfigs()).map((preconfig) => withRetrievalTool(preconfig)!),
};

export const jean2AgentSource: AgentSource = {
  getDirectory: async () => null,
  readMemoryFile: async () => null,
};

export const jean2InstructionSource: InstructionSource = {
  getGlobalPath: getGlobalAgentsPath,
};

export function configureJean2PreconfigSource(agents: AgentsApplication): void {
  jean2PreconfigSource.getForAgent = async (id) => withRetrievalTool(await agents.getPreconfigOrAgent(id));
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
