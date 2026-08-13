import type {
  AskAuthority,
  AskRequestMessage,
  AssistantMessage,
  AutoApproveSeverity,
  AskTimedOutMessage,
  MessageWithParts,
  PermissionGrant,
  PermissionGrantOptions,
  PermissionResource,
  Ask,
  ServerMessage,
  Session,
} from '@jean2/sdk';
import type { WorkspaceCapabilityHost } from '../tools/workspace-capability';

export type AskBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;
export type BroadcastFn = (message: ServerMessage) => void;
export type BroadcastSessionFn = (session: Session) => void;

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

export interface Jean2InteractionBindings {
  createPendingAsk(record: Omit<PendingAskRecord, 'id'>): string;
  removePendingAsk(id: string): void;
  removePendingAsksByToolCallId(toolCallId: string): void;
  getPermissionRequestByRequestId(requestId: string): PendingAskRecord | null;
  resolvePermissionRequestByRequestId(
    requestId: string,
    status: 'approved' | 'denied',
    resolution?: unknown,
  ): boolean;
  expirePermissionRequest(id: string): boolean;
  expireOldPermissionRequests(maxAgeMs: number): number;
  cancelPendingRequestsBySession(sessionId: string): number;
  listPendingAsksBySession(sessionId: string): PendingAskRecord[];
  listPendingAsksByRootSession(rootSessionId: string): PendingAskRecord[];
  listPendingRequestsByRootSession(rootSessionId: string): PendingAskRecord[];
  matchGrant(params: MatchGrantParams): { matched: boolean; grant: PermissionGrant | null };
  createGrantFromOptions(params: CreateGrantParams): PermissionGrant | null;
  getSessionAutoApproveSeverity(sessionId: string): AutoApproveSeverity | undefined;
  getPermissionTimeoutMs(): number;
  notifyPermissionRequired(requestId: string, rootSessionId: string): void;
}

export interface Jean2DeliveryBindings {
  broadcastEvent(message: ServerMessage): void;
  broadcastSessionCreated(session: Session): void;
  broadcastSessionUpdated(session: Session): void;
  broadcastToSessionEvent(sessionId: string, message: ServerMessage): void;
  sendToControllerEvent(sessionId: string, message: ServerMessage): void;
  sendToAskTargetsEvent(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
  notifyTerminalMessage(message: AssistantMessage, sessionId: string): void;
}

export interface Jean2TitleBindings {
  isDefaultSessionTitle(title: string | null | undefined): boolean;
  hasManualSessionTitle(metadata: Record<string, unknown> | null | undefined): boolean;
  generateSessionTitle(messages: MessageWithParts[]): Promise<string | null>;
}



export interface Jean2WorkspaceCapabilityBindings {
  createToolWorkspaceHost(options: {
    workspaceId?: string;
    workspacePath?: string;
    additionalPaths?: string[];
    sessionId: string;
  }): WorkspaceCapabilityHost;
}

export interface Jean2SandboxBindings {
  isSandboxActive(): boolean;
}

export interface Jean2CompatibilityBindings {
  interaction: Jean2InteractionBindings;
  delivery: Jean2DeliveryBindings;
  titles: Jean2TitleBindings;
  workspace: Jean2WorkspaceCapabilityBindings;
  sandbox: Jean2SandboxBindings;
}

let bindings: Jean2CompatibilityBindings | null = null;

export function setJean2CompatibilityBindings(value: Jean2CompatibilityBindings): void {
  bindings = value;
}

export function getJean2CompatibilityBindings(): Jean2CompatibilityBindings {
  if (!bindings) {
    throw new Error('Jean2 compatibility bindings have not been configured');
  }
  return bindings;
}
