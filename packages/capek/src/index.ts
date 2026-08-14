export const capekPackagePhase = 7 as const;

export { createAgent } from './facade/create-agent';
export type {
  Agent,
  AgentError,
  AgentEvent,
  AgentInput,
  AgentPart,
  AgentResult,
  AgentStorageOption,
  RunOptions,
  UsageSummary,
} from './facade/types';
