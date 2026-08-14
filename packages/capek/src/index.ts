export const capekPackagePhase = 8 as const;

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
export type {
  RuntimeAudience,
  RuntimeDelivery,
  RuntimeEvent,
  RuntimeEventContext,
  RuntimeEventSink,
} from './runtime/events';
