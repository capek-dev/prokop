import type { PermissionAsk, PermissionRiskLevel } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { createPendingAsk, expirePermissionRequest,
  resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';

const AUTHORITY = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } as const;
const COMMAND_TOOL = 'codex-cli:command';
const FILE_TOOL = 'codex-cli:file-change';
const DECLINE = { decision: 'decline' } as const;
const AUTO_APPROVE_RISKS: PermissionRiskLevel[] = ['none', 'low', 'medium', 'high'];

/** Codex hook approvals follow the session risk ceiling, but never auto-approve critical or unknown risk. */
export function canAutoApproveCodexHook(ask: PermissionAsk, severity: unknown): boolean {
  if (ask.type !== 'permission' || typeof ask.risk !== 'string' || typeof severity !== 'string') return false;
  const risk = AUTO_APPROVE_RISKS.indexOf(ask.risk as PermissionRiskLevel);
  const ceiling = AUTO_APPROVE_RISKS.indexOf(severity as PermissionRiskLevel);
  return risk !== -1 && ceiling !== -1 && risk <= ceiling;
}

type Decision = { decision: 'accept' | 'decline' };
interface Pending {
  requestId: string;
  toolCallId: string;
  sessionId: string;
  dbId: string;
  timer: ReturnType<typeof setTimeout>;
  finish(decision: Decision): void;
  delivery: ApplicationDeliveryPort<unknown>;
  key: string | null;
  workspaceId: string;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only live Codex requests can resolve; persisted records are for reconnect and audit, not replay. */
export class CodexApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly byTool = new Map<string, string>();
  private readonly hookApprovedCommands = new Map<string, Set<string>>();

  private hookKey(threadId: string, turnId: string, root: string, command: string, itemId: string): string {
    return JSON.stringify([threadId, turnId, root, command, itemId]);
  }

  async requestHook(
    ask: PermissionAsk, toolName: 'Bash' | 'apply_patch', command: string, toolUseId: string,
    threadId: string, turnId: string, sessionId: string, root: string,
    workspaceId: string, delivery: ApplicationDeliveryPort<unknown>,
  ): Promise<boolean> {
    const session = getSession(sessionId);
    if (session?.harness !== 'codex-cli') return false;
    if (!canAutoApproveCodexHook(ask, session.autoApproveSeverity)) {
      const decision = await this.enqueue(ask, toolName === 'Bash' ? COMMAND_TOOL : FILE_TOOL,
        null, sessionId, workspaceId, delivery);
      if (decision.decision !== 'accept') return false;
    }
    if (toolName === 'Bash') {
      let keys = this.hookApprovedCommands.get(sessionId);
      if (!keys) { keys = new Set(); this.hookApprovedCommands.set(sessionId, keys); }
      keys.add(this.hookKey(threadId, turnId, root, command, toolUseId));
    }
    return true;
  }

  private async requestDynamicTool(ask: PermissionAsk, toolName: string, sessionId: string,
    workspaceId: string, delivery: ApplicationDeliveryPort<unknown>): Promise<boolean> {
    const session = getSession(sessionId);
    if (session?.harness !== 'codex-cli' || session.workspaceId !== workspaceId) return false;
    if (canAutoApproveCodexHook(ask, session.autoApproveSeverity)) return true;
    return (await this.enqueue({ ...ask, allowedScopes: ['once'] }, toolName,
      null, sessionId, workspaceId, delivery)).decision === 'accept';
  }

  /** Memory writes follow the session risk ceiling, otherwise ask the controller once. */
  requestMemory(ask: PermissionAsk, sessionId: string, workspaceId: string,
    delivery: ApplicationDeliveryPort<unknown>): Promise<boolean> {
    return this.requestDynamicTool(ask, 'codex-cli:memory', sessionId, workspaceId, delivery);
  }

  /** Session search reads follow the same ceiling and once-only fallback. */
  requestSessionSearch(ask: PermissionAsk, sessionId: string, workspaceId: string,
    delivery: ApplicationDeliveryPort<unknown>): Promise<boolean> {
    return this.requestDynamicTool(ask, 'codex-cli:session_search', sessionId, workspaceId, delivery);
  }

  private enqueue(ask: PermissionAsk, toolName: string, key: string | null,
    sessionId: string, workspaceId: string, delivery: ApplicationDeliveryPort<unknown>): Promise<Decision> {
    const requestId = crypto.randomUUID();
    const toolCallId = `codex-approval:${crypto.randomUUID()}`;
    const timeoutMs = this.timeoutMs();
    const now = Date.now();
    const dbId = createPendingAsk({ requestId, toolCallId, toolName,
      sessionId, rootSessionId: sessionId, workspaceId, ask, isPermission: true,
      status: 'pending', createdAt: now, expiresAt: now + timeoutMs });
    return new Promise<Decision>(resolve => {
      const timer = setTimeout(() => this.settle(requestId, DECLINE, 'expired'), timeoutMs);
      this.pending.set(requestId, { requestId, toolCallId, sessionId, dbId, timer,
        finish: resolve, delivery, key, workspaceId });
      this.byTool.set(toolCallId, requestId);
      try {
        delivery.sendToAskTargets(sessionId, AUTHORITY, { type: 'ask.request', sessionId,
          toolCallId, toolName, requestId, authority: AUTHORITY, ask });
      } catch {
        this.settle(requestId, DECLINE, 'expired');
      }
    });
  }

  constructor(private readonly timeoutMs: () => number = getPermissionTimeoutMs) {}

  hasLiveRequest(requestId: string): boolean { return this.pending.has(requestId); }

  getSessionId(toolCallId: string, requestId?: string): string | null {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return null;
    return this.pending.get(requestId)?.sessionId ?? null;
  }

  async request(
    method: string, raw: unknown, threadId: string, turnId: string,
    sessionId: string, root: string, workspaceId: string, delivery: ApplicationDeliveryPort<unknown>,
  ): Promise<Decision> {
    const params = object(raw);
    if (!params || params.threadId !== threadId || params.turnId !== turnId || !validId(params.itemId)) return DECLINE;
    const command = method === 'item/commandExecution/requestApproval';
    if (!command && method !== 'item/fileChange/requestApproval') return DECLINE;
    if (command && (params.kind !== undefined && params.kind !== 'command'
      || params.additionalPermissions != null || params.proposedExecpolicyAmendment != null
      || params.proposedNetworkPolicyAmendments != null || params.networkApprovalContext != null
      || params.approvalId != null)) return DECLINE;
    if (command && (typeof params.command !== 'string' || !params.command.trim()
      || typeof params.cwd !== 'string' || params.cwd !== root)) return DECLINE;
    if (!command && params.grantRoot != null) return DECLINE;

    const key = command ? JSON.stringify([root, params.command]) : null;
    const hookKey = command ? this.hookKey(threadId, turnId, root, params.command as string, params.itemId as string) : null;
    if (hookKey && this.hookApprovedCommands.get(sessionId)?.delete(hookKey)) {
      return { decision: 'accept' };
    }
    if (key) {
      const matched = matchGrant({ workspaceId, toolName: COMMAND_TOOL, resource: 'shell-command',
        action: 'execute', permissionKey: key, rootSessionId: sessionId });
      // Legacy unbound session grants must not cross session boundaries.
      if (matched.matched && matched.grant && (matched.grant.scope === 'workspace'
        || matched.grant.scope === 'session' && matched.grant.boundRootSessionId === sessionId)) {
        return { decision: 'accept' };
      }
    }

    const ask: PermissionAsk = command ? {
      type: 'permission', question: 'Allow Codex to run this command?',
      description: typeof params.reason === 'string' ? params.reason : `Working directory: ${root}`,
      resource: 'shell-command', action: 'execute', risk: 'critical',
      metadata: { command: params.command, cwd: root },
      allowedScopes: ['once', 'session', 'workspace'],
    } : {
      type: 'permission', question: 'Allow Codex to change files?',
      description: typeof params.reason === 'string' ? params.reason : 'Codex did not provide file paths for this request.',
      resource: 'file', action: 'write', risk: 'critical', allowedScopes: ['once'],
    };
    return this.enqueue(ask, command ? COMMAND_TOOL : FILE_TOOL, key, sessionId, workspaceId, delivery);
  }

  async resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return false;
    const pending = this.pending.get(requestId);
    if (!pending || pending.toolCallId !== toolCallId || getSession(pending.sessionId)?.harness !== 'codex-cli') return false;
    const value = object(response);
    const grant = value?.type === 'permission' ? value.grant : undefined;
    const allowed = pending.key ? ['once', 'session', 'workspace'] : ['once'];
    const approved = typeof grant === 'string' && allowed.includes(grant)
      && value?.scope === undefined && value?.duration === undefined;
    const decision = approved ? { decision: 'accept' } as const : DECLINE;
    try {
      const resolved = getDatabase().transaction(() => {
        if (!resolvePermissionRequestByRequestId(requestId, approved ? 'approved' : 'denied', response)) return false;
        if (approved && pending.key && (grant === 'session' || grant === 'workspace')) {
          createGrantFromOptions({ workspaceId: pending.workspaceId, toolName: COMMAND_TOOL,
            resource: 'shell-command', action: 'execute', permissionKey: pending.key,
            grantOptions: { scope: grant,
              matcher: 'exact', action: 'execute', patterns: [pending.key],
              ...(grant === 'session' ? { boundRootSessionId: pending.sessionId } : {}) } });
        }
        return true;
      })();
      if (!resolved) {
        this.settle(requestId, DECLINE, 'expired');
        return false;
      }
    } catch {
      // A grant failure rolls back the approval. Never accept without its requested scope.
      try {
        resolvePermissionRequestByRequestId(requestId, 'denied', response);
      } finally {
        this.settle(requestId, DECLINE, 'resolved');
      }
      return true;
    }
    this.settle(requestId, decision, 'resolved');
    return true;
  }

  cancelSession(sessionId: string): void {
    this.hookApprovedCommands.delete(sessionId);
    for (const [id, pending] of this.pending) {
      if (pending.sessionId === sessionId) this.settle(id, DECLINE, 'expired');
    }
  }

  private settle(requestId: string, decision: Decision, status: 'expired' | 'resolved'): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    this.byTool.delete(pending.toolCallId);
    clearTimeout(pending.timer);
    if (status === 'expired') expirePermissionRequest(pending.dbId);
    try {
      pending.delivery.broadcastToSession(pending.sessionId, { type: 'ask.timeout',
        sessionId: pending.sessionId, toolCallId: pending.toolCallId, requestId });
    } finally {
      pending.finish(decision);
    }
  }
}

export const codexApprovals = new CodexApprovals();
