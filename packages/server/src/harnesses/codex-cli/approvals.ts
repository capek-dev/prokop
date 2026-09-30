import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { PermissionAsk } from '@prokopai/sdk';
import { canAutoApproveHarnessTool } from '@/harnesses/approval-policy';
import { severityFromMode } from '@/domains/permissions';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { createPendingAsk, expirePermissionRequest,
  resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { logCodexPermissionDenial, type CodexPermissionReason } from './permission-diagnostics';

const AUTHORITY = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } as const;
const COMMAND_TOOL = 'codex-cli:command';
const FILE_TOOL = 'codex-cli:file-change';
const DECLINE = { decision: 'decline' } as const;
/** Codex hook approvals follow the shared native harness risk ceiling. */
export const canAutoApproveCodexHook = canAutoApproveHarnessTool;

type Decision = { decision: 'accept' | 'decline' };
interface Pending {
  requestId: string;
  toolCallId: string;
  sessionId: string;
  controllerSessionId: string;
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
    workspaceId: string, delivery: ApplicationDeliveryPort<unknown>, controllerSessionId = sessionId,
  ): Promise<boolean> {
    const session = getSession(sessionId);
    if (session?.harness !== 'codex-cli') return false;
    if (!canAutoApproveCodexHook(ask, severityFromMode(session.permissionMode ?? 'standard'))) {
      const decision = await this.enqueue(ask, toolName === 'Bash' ? COMMAND_TOOL : FILE_TOOL,
        null, sessionId, workspaceId, delivery, controllerSessionId);
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
    if (canAutoApproveCodexHook(ask, severityFromMode(session.permissionMode ?? 'standard'))) return true;
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
    sessionId: string, workspaceId: string, delivery: ApplicationDeliveryPort<unknown>,
    controllerSessionId = sessionId): Promise<Decision> {
    const requestId = crypto.randomUUID();
    const toolCallId = `codex-approval:${crypto.randomUUID()}`;
    const timeoutMs = this.timeoutMs();
    const now = Date.now();
    const dbId = createPendingAsk({ requestId, toolCallId, toolName,
      sessionId, rootSessionId: controllerSessionId, workspaceId, ask, isPermission: true,
      status: 'pending', createdAt: now, expiresAt: now + timeoutMs });
    return new Promise<Decision>(resolve => {
      const timer = setTimeout(() => this.settle(requestId, DECLINE, 'expired'), timeoutMs);
      this.pending.set(requestId, { requestId, toolCallId, sessionId, controllerSessionId, dbId, timer,
        finish: resolve, delivery, key, workspaceId });
      this.byTool.set(toolCallId, requestId);
      try {
        const deliveredAsk: PermissionAsk & { _originSessionId?: string } = controllerSessionId === sessionId
          ? ask : { ...ask, _originSessionId: sessionId };
        delivery.sendToAskTargets(controllerSessionId, AUTHORITY, { type: 'ask.request',
          sessionId: controllerSessionId, toolCallId, toolName, requestId, authority: AUTHORITY,
          ask: deliveredAsk });
      } catch {
        this.settle(requestId, DECLINE, 'expired');
      }
    });
  }

  constructor(private readonly timeoutMs: () => number = getPermissionTimeoutMs) {}

  hasLiveRequest(requestId: string): boolean { return this.pending.has(requestId); }

  getSessionId(toolCallId: string, requestId?: string): string | null {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return null;
    return this.pending.get(requestId)?.controllerSessionId ?? null;
  }

  async request(
    method: string, raw: unknown, threadId: string, turnId: string,
    sessionId: string, root: string, workspaceId: string, delivery: ApplicationDeliveryPort<unknown>,
    childOnceOnly = false, controllerSessionId = sessionId,
  ): Promise<Decision> {
    const decline = (reason: CodexPermissionReason): Decision => {
      logCodexPermissionDenial('native', reason);
      return DECLINE;
    };
    const params = object(raw);
    if (!params || params.threadId !== threadId || params.turnId !== turnId || !validId(params.itemId)) {
      return decline('malformed-request');
    }
    const command = method === 'item/commandExecution/requestApproval';
    if (!command && method !== 'item/fileChange/requestApproval') return decline('unsupported-request');
    if (command && (params.kind !== undefined && params.kind !== 'command'
      || params.additionalPermissions != null || params.proposedExecpolicyAmendment != null
      || params.proposedNetworkPolicyAmendments != null || params.networkApprovalContext != null
      || params.approvalId != null)) return decline('unsupported-permissions');
    if (command && (typeof params.command !== 'string' || !params.command.trim()
      || typeof params.cwd !== 'string')) return decline('malformed-request');
    if (command && params.cwd !== root) {
      if (!childOnceOnly) return decline('working-directory');
      try {
        const offset = relative(root, realpathSync(params.cwd as string));
        if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return decline('working-directory');
      } catch { return decline('working-directory'); }
    }
    if (!command && params.grantRoot != null) return decline('unsupported-permissions');

    const key = command && !childOnceOnly ? JSON.stringify([root, params.command]) : null;
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
      metadata: { command: params.command, cwd: params.cwd },
      allowedScopes: childOnceOnly ? ['once'] : ['once', 'session', 'workspace'],
    } : {
      type: 'permission', question: 'Allow Codex to change files?',
      description: typeof params.reason === 'string' ? params.reason : 'Codex did not provide file paths for this request.',
      resource: 'file', action: 'write', risk: 'critical', allowedScopes: ['once'],
    };
    const decision = await this.enqueue(ask, command ? COMMAND_TOOL : FILE_TOOL, key, sessionId, workspaceId,
      delivery, controllerSessionId);
    if (decision.decision === 'decline') logCodexPermissionDenial('native', 'ask-declined');
    return decision;
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
      pending.delivery.broadcastToSession(pending.controllerSessionId, { type: 'ask.timeout',
        sessionId: pending.controllerSessionId, toolCallId: pending.toolCallId, requestId });
    } finally {
      pending.finish(decision);
    }
  }
}

export const codexApprovals = new CodexApprovals();
