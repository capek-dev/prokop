import { AsyncLocalStorage } from 'node:async_hooks';
import type { HostLayout } from './host-layout';
import type { Ask } from '@capekai/tool';
import type {
  AskRequestMessage, AskTimedOutMessage, AutoApproveSeverity, MessageWithParts, Session,
} from '@capekai/types';
import type { PermissionGrant, PermissionGrantOptions, PermissionResource } from '@capekai/tool';
import type { WorkspaceCapabilityHost } from '../workspace/contracts';
import type { RuntimeDelivery, RuntimeEvent } from './events';

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
  getSessionAutoApproveSeverity(sessionId: string): Promise<AutoApproveSeverity | undefined>;
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

export interface WorkspaceCapabilityBindings {
  createToolWorkspaceHost(options: {
    workspaceId?: string;
    workspacePath?: string;
    additionalPaths?: string[];
    sessionId: string;
  }): WorkspaceCapabilityHost;
}

export interface SandboxBindings {
  isSandboxActive(): boolean;
}

export interface RuntimeHost {
  interaction: InteractionHost;
  delivery: DeliveryHost;
  titles: TitleHost;
  workspace: WorkspaceCapabilityBindings;
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

export function getRuntimeHost(): RuntimeHost {
  const active = scopedHost.getStore() ?? host;
  if (!active) throw new Error('Runtime host has not been configured');
  return active;
}
