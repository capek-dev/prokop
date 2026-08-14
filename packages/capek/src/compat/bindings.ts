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

export function setJean2CompatibilityBindings(value: Jean2CompatibilityBindings): void {
  configureRuntimeHost(value);
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
