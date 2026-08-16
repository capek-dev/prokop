import {
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
import { installSchedulerToolFallback } from '../plugins/scheduler-domain';
import { installSessionSearchToolFallback } from '../plugins/session-search-domain';
import { installTaskToolFallback } from '../plugins/subagent-domain';
import { installWorkflowToolFallback } from '../plugins/workflow-domain';
import { installMemoryToolFallback } from '../plugins/memory-domain';
import { installSkillsToolFallback } from '../plugins/skills-domain';

export type Jean2InteractionBindings = InteractionHost;
export type Jean2DeliveryBindings = DeliveryHost;
export type Jean2TitleBindings = TitleHost;
export type Jean2WorkspaceCapabilityBindings = WorkspaceCapabilityBindings;
export type Jean2SandboxBindings = SandboxBindings;
export type Jean2CompatibilityBindings = RuntimeHost;

export type {
  AskBroadcastFn,
  BroadcastFn,
  BroadcastSessionFn,
  CreateGrantParams,
  MatchGrantParams,
  PendingAskRecord,
  PermissionRequestStatus,
};

/** Installing the Jean2 compatibility bindings also installs the unscoped
 * session-search, scheduler, task, workflow, memory, and skills tool
 * fallbacks for the legacy buildAiSdkTools path. This is the explicit
 * compatibility configuration path the server bootstrap calls
 * (`configureJean2Bindings` -> this function); nothing registers at module
 * load. Idempotent. */
export function setJean2CompatibilityBindings(value: Jean2CompatibilityBindings): void {
  configureRuntimeHost(value);
  installSessionSearchToolFallback();
  installSchedulerToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}

export function withJean2CompatibilityBindings<T>(value: Jean2CompatibilityBindings, callback: () => T): T {
  return withRuntimeHost(value, callback);
}

export function getJean2CompatibilityBindings(): Jean2CompatibilityBindings {
  try {
    return getRuntimeHost();
  } catch {
    throw new Error('Jean2 compatibility bindings have not been configured');
  }
}
