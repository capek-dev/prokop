export const capekPackagePhase = 9 as const;

export { createAgent } from './facade/create-agent';
export type { CreateAgentOptions } from './facade/create-agent';
export type { FacadeProfileId } from './profiles/facade';
export type {
  Agent,
  AgentDiagnostics,
  AgentError,
  AgentEvent,
  AgentInput,
  AgentPart,
  AgentResult,
  AgentStorageOption,
  RunOptions,
  UsageSummary,
} from './facade/types';
export type { ToolOutputArtifactPage } from './storage/contracts';
export type {
  RuntimeAudience,
  RuntimeDelivery,
  RuntimeEvent,
  RuntimeEventContext,
  RuntimeEventSink,
} from './runtime/events';
