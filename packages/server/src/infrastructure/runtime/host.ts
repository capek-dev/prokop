import { AsyncLocalStorage } from 'node:async_hooks';
import type { HostLayout } from '@/infrastructure/runtime/host-layout';
import type { Ask, ToolDefinition } from '@prokopai/sdk/tool';
import type {
  AskRequestMessage, AskTimedOutMessage, AutoApproveSeverity, MessageWithParts, Session,
} from '@prokopai/sdk/types';
import type { PermissionGrant, PermissionGrantOptions, PermissionResource } from '@prokopai/sdk/tool';
import type { WorkspaceCapabilityHost } from '@/infrastructure/filesystem/workspace-policy/contracts';
import type { RuntimeDelivery, RuntimeEvent } from '@/infrastructure/runtime/events';

export type AskEventSink = (message: AskRequestMessage | AskTimedOutMessage) => void;
export type RuntimeEventSink = (event: RuntimeEvent) => void;
export type SessionEventSink = (session: Session) => void;
export type AskBroadcastFn = AskEventSink;
export type BroadcastFn = RuntimeEventSink;
export type BroadcastSessionFn = SessionEventSink;
export type PermissionRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';

export interface PendingAskRecord {
  id: string;
  requestId: string;
  sessionId: string;
  rootSessionId?: string;
  originSessionId?: string;
  workspaceId?: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  status: PermissionRequestStatus;
  isPermission: boolean;
  expiresAt?: number;
  resolvedAt?: number;
  resolution?: unknown;
  createdAt: number;
}

export interface MatchGrantParams {
  workspaceId: string;
  toolName: string;
  resource: PermissionResource;
  action?: string;
  permissionKey: string;
  rootSessionId?: string;
}

export interface CreateGrantParams {
  workspaceId: string;
  toolName: string;
  resource: PermissionResource;
  action?: string;
  permissionKey: string;
  grantOptions: PermissionGrantOptions;
}

export interface InteractionHost {
  createPendingAsk(record: Omit<PendingAskRecord, 'id'>): Promise<string>;
  removePendingAsk(id: string): Promise<void>;
  removePendingAsksByToolCallId(toolCallId: string): Promise<void>;
  getPermissionRequestByRequestId(requestId: string): Promise<PendingAskRecord | null>;
  resolvePermissionRequestByRequestId(requestId: string, status: 'approved' | 'denied', resolution?: unknown): Promise<boolean>;
  expirePermissionRequest(id: string): Promise<boolean>;
  expireOldPermissionRequests(maxAgeMs: number): Promise<number>;
  cancelPendingRequestsBySession(sessionId: string): Promise<number>;
  listPendingAsksBySession(sessionId: string): Promise<PendingAskRecord[]>;
  listPendingAsksByRootSession(rootSessionId: string): Promise<PendingAskRecord[]>;
  listPendingRequestsByRootSession(rootSessionId: string): Promise<PendingAskRecord[]>;
  matchGrant(params: MatchGrantParams): Promise<{ matched: boolean; grant: PermissionGrant | null }>;
  createGrantFromOptions(params: CreateGrantParams): Promise<PermissionGrant | null>;
  /** @deprecated Hosts that decide permissions themselves (a seeded policy
   * service, or pre-classified asks) should not implement this getter; the
   * default provider fails closed (never auto-approves) when it is absent. */
  getSessionAutoApproveSeverity?(sessionId: string): Promise<AutoApproveSeverity | undefined>;
  getPermissionTimeoutMs(): number;
  notifyPermissionRequired(requestId: string, rootSessionId: string): Promise<void>;
}

export interface DeliveryHost {
  emit(delivery: RuntimeDelivery): void;
  observe?(delivery: RuntimeDelivery): void;
}

export interface TitleHost {
  isDefaultSessionTitle(title: string | null | undefined): boolean;
  hasManualSessionTitle(metadata: Record<string, unknown> | null | undefined): boolean;
  generateSessionTitle(messages: MessageWithParts[]): Promise<string | null>;
}

export interface SessionWorkspaceContext {
  workspacePath?: string;
  additionalPaths?: string[];
}

export interface WorkspaceCapabilityBindings {
  resolveSessionWorkspace?(options: {
    sessionId: string;
    workspaceId?: string;
    workspaceRootId?: string;
    workspacePath?: string;
    additionalPaths?: string[];
  }): SessionWorkspaceContext | Promise<SessionWorkspaceContext>;
  createToolWorkspaceHost(options: {
    workspaceId?: string;
    workspacePath?: string;
    additionalPaths?: string[];
    sessionId: string;
  }): WorkspaceCapabilityHost;
}

export interface ToolPolicyHost {
  resolveDefinition?(options: {
    sessionId: string;
    workspaceId?: string;
    workspaceRootId?: string;
    workspacePath?: string;
    definition: ToolDefinition;
  }): ToolDefinition | null | Promise<ToolDefinition | null>;
}

export interface SandboxBindings {
  isSandboxActive(): boolean;
}

export interface RuntimeHost {
  interaction: InteractionHost;
  delivery: DeliveryHost;
  titles: TitleHost;
  workspace: WorkspaceCapabilityBindings;
  toolPolicy?: ToolPolicyHost;
  sandbox: SandboxBindings;
  /** Host-supplied filesystem layout policy. */
  layout?: HostLayout;
  guidance?: {
    memory?: string;
    agentMemorySkills?: string;
    skillManage?: string;
    sessionSearch?: string;
  };
}

let host: RuntimeHost | null = null;
const scopedHost = new AsyncLocalStorage<RuntimeHost>();

export function configureRuntimeHost(value: RuntimeHost): void {
  host = value;
}

export function withRuntimeHost<T>(value: RuntimeHost, callback: () => T): T {
  return scopedHost.run(value, callback);
}

export function getOptionalRuntimeHost(): RuntimeHost | null {
  return scopedHost.getStore() ?? host;
}

export function getRuntimeHost(): RuntimeHost {
  const active = getOptionalRuntimeHost();
  if (!active) throw new Error('Runtime host has not been configured');
  return active;
}
