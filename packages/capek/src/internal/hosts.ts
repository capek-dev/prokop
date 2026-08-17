/**
 * Internal host-composition entrypoint (`@capekai/core/internal/hosts`).
 *
 * Exposes exactly the process-global host configuration the Jean2 server
 * bootstrap installs: runtime host bindings, session-search and scheduler
 * hosts, and context sources. Every symbol resolves to the owning module's
 * identity, identical to the compatibility barrel. S8a.
 */

export {
  configureRuntimeHost,
  getRuntimeHost,
  withRuntimeHost,
  type AskBroadcastFn,
  type BroadcastFn,
  type BroadcastSessionFn,
  type CreateGrantParams,
  type DeliveryHost,
  type InteractionHost,
  type MatchGrantParams,
  type PendingAskRecord,
  type PermissionRequestStatus,
  type RuntimeHost,
  type SandboxBindings,
  type TitleHost,
  type WorkspaceCapabilityBindings,
} from '../runtime/host';
export { installSchedulerToolFallback } from '../plugins/scheduler-domain';
export { installSessionSearchToolFallback } from '../plugins/session-search-domain';
export { installTaskToolFallback } from '../plugins/subagent-domain';
export { installWorkflowToolFallback } from '../plugins/workflow-domain';
export { installMemoryToolFallback } from '../plugins/memory-domain';
export { installSkillsToolFallback } from '../plugins/skills-domain';
export { configureSessionSearchHost, type SessionSearchHost } from '../session-search/host';
export { configureSchedulerHost, type SchedulerHost } from '../scheduler/host';
export {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  type AgentSource,
  type InstructionSource,
  type PreconfigSource,
} from '../context/sources';
