import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  type AgentSource,
  type InstructionSource,
  type PreconfigSource,
} from '@/harnesses/prokop/context/sources';
import { RETRIEVE_TOOL_OUTPUT_NAME } from '@/harnesses/prokop/tool-output/policy';
import type { Preconfig } from '@prokopai/sdk/types';
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

export const prokopPreconfigSource: PreconfigSource = {
  get: async (id) => withRetrievalTool(await getPreconfig(id)),
  getDefault: async () => withRetrievalTool(await getDefaultPreconfig()),
  getForAgent: async () => null,
  list: async () => (await listPreconfigs()).map((preconfig) => withRetrievalTool(preconfig)!),
  listSubagents: async () => (await listSubagentPreconfigs()).map((preconfig) => withRetrievalTool(preconfig)!),
};

export const prokopAgentSource: AgentSource = {
  getDirectory: async () => null,
  readMemoryFile: async () => null,
};

export const prokopInstructionSource: InstructionSource = {
  getGlobalPath: getGlobalAgentsPath,
};

export function configureProkopPreconfigSource(agents: AgentsApplication): void {
  prokopPreconfigSource.getForAgent = async (id) => withRetrievalTool(await agents.getPreconfigOrAgent(id));
  configurePreconfigSource(prokopPreconfigSource);
}

export function configureProkopAgentSource(agents: AgentsApplication): void {
  prokopAgentSource.getDirectory = (id) => agents.getAgentDirectory(id);
  prokopAgentSource.readMemoryFile = (id, filename) => agents.readAgentMemoryFile(id, filename);
  configureAgentSource(prokopAgentSource);
}

export function configureProkopInstructionSource(): void {
  configureInstructionSource(prokopInstructionSource);
}
