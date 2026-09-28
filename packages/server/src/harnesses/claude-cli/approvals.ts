import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { canAutoApproveHarnessTool } from '../approval-policy';
import { classifyClaudeTool } from './tool-policy';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { createPendingAsk, expirePermissionRequest, resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getControllerConnections, isControlled } from '@/transport/websocket/control-registry';

const AUTHORITY = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' } as const;
const denied = (message: string): PermissionResult => ({ behavior: 'deny', message });

interface Pending {
  sessionId: string;
  toolCallId: string;
  dbId: string;
  timer: ReturnType<typeof setTimeout>;
  finish(result: PermissionResult): void;
  delivery: ApplicationDeliveryPort<unknown>;
}

/** Live approval waiters are never restored from SQLite after a process restart. */
export class ClaudeApprovals {
  private readonly pending = new Map<string, Pending>();
  private readonly byTool = new Map<string, string>();
  constructor(private readonly timeoutMs: () => number = getPermissionTimeoutMs) {}

  hasLiveRequest(requestId: string): boolean { return this.pending.has(requestId); }
  getSessionId(toolCallId: string, requestId?: string): string | null {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return null;
    return this.pending.get(requestId)?.sessionId ?? null;
  }

  request(sessionId: string, workspaceId: string, root: string,
    delivery: ApplicationDeliveryPort<unknown>, signal: AbortSignal): CanUseTool {
    return async (toolName, input, options) => {
      const session = getSession(sessionId);
      if (signal.aborted || options.signal.aborted || session?.harness !== 'claude-cli'
        || session.workspaceId !== workspaceId) return denied('Claude tool request is no longer active');
      if (options.blockedPath) return denied('Claude tool path is blocked');
      if (!toolName || toolName.length > 256 || !input || typeof input !== 'object' || Array.isArray(input)) {
        return denied('Malformed Claude tool');
      }
      const ask = classifyClaudeTool(toolName, input as Record<string, unknown>, root);
      if (ask === null) return denied('Malformed Claude tool');
      // Tools without a Prokop risk rule use the SDK's native behavior, regardless of the session ceiling.
      if (ask === undefined) return { behavior: 'allow' };
      if (canAutoApproveHarnessTool(ask, session.autoApproveSeverity)) return { behavior: 'allow' };
      if (!isControlled(sessionId) || getControllerConnections(sessionId).length === 0) {
        return denied('Claude tool requires a connected controller');
      }
      const requestId = crypto.randomUUID();
      const toolCallId = `claude-approval:${crypto.randomUUID()}`;
      const timeout = this.timeoutMs();
      const now = Date.now();
      const dbId = createPendingAsk({ requestId, toolCallId, toolName: `claude-cli:${toolName}`,
        sessionId, rootSessionId: sessionId, workspaceId, ask, isPermission: true,
        status: 'pending', createdAt: now, expiresAt: now + timeout });
      return new Promise<PermissionResult>(resolve => {
        const timer = setTimeout(() => this.settle(requestId, denied('Claude permission timed out'), true), timeout);
        this.pending.set(requestId, { sessionId, toolCallId, dbId, timer, finish: resolve, delivery });
        this.byTool.set(toolCallId, requestId);
        const abort = () => this.settle(requestId, denied('Claude turn interrupted'), true);
        signal.addEventListener('abort', abort, { once: true });
        options.signal.addEventListener('abort', abort, { once: true });
        try {
          delivery.sendToAskTargets(sessionId, AUTHORITY, { type: 'ask.request', sessionId,
            toolCallId, toolName: `claude-cli:${toolName}`, requestId, authority: AUTHORITY, ask });
          if (signal.aborted || options.signal.aborted) abort();
        } catch { abort(); }
      });
    };
  }

  async resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
    if (!requestId || this.byTool.get(toolCallId) !== requestId) return false;
    const pending = this.pending.get(requestId);
    if (!pending || pending.toolCallId !== toolCallId || getSession(pending.sessionId)?.harness !== 'claude-cli') return false;
    const value = response && typeof response === 'object' && !Array.isArray(response)
      ? response as Record<string, unknown> : null;
    const allowed = isControlled(pending.sessionId)
      && getControllerConnections(pending.sessionId).length > 0
      && value?.type === 'permission' && value.grant === 'once'
      && value.scope === undefined && value.duration === undefined;
    if (!resolvePermissionRequestByRequestId(requestId, allowed ? 'approved' : 'denied', response)) {
      this.settle(requestId, denied('Claude permission expired'), true);
      return false;
    }
    this.settle(requestId, allowed ? { behavior: 'allow' } : denied('Claude permission denied'), false);
    return true;
  }

  cancelSession(sessionId: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.sessionId === sessionId) this.settle(id, denied('Claude turn interrupted'), true);
    }
  }

  private settle(id: string, result: PermissionResult, expired: boolean): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    this.byTool.delete(pending.toolCallId);
    clearTimeout(pending.timer);
    if (expired) expirePermissionRequest(pending.dbId);
    pending.delivery.broadcastToSession(pending.sessionId, { type: 'ask.timeout',
      sessionId: pending.sessionId, toolCallId: pending.toolCallId, requestId: id });
    pending.finish(result);
  }
}

export const claudeApprovals = new ClaudeApprovals();
