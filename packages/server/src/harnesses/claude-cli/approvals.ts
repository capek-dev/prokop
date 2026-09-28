import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { PermissionAsk } from '@prokopai/sdk';
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

  request(sessionId: string, workspaceId: string, delivery: ApplicationDeliveryPort<unknown>, signal: AbortSignal): CanUseTool {
    return async (toolName, input, options) => {
      if (signal.aborted || options.signal.aborted || getSession(sessionId)?.harness !== 'claude-cli') {
        return denied('Claude tool request is no longer active');
      }
      if (!isControlled(sessionId) || getControllerConnections(sessionId).length === 0) {
        return denied('Claude tool requires a connected controller');
      }
      if (options.blockedPath) return denied('Claude tool path is blocked');
      // Never approve an unknown tool, an out-of-scope MCP tool, or a child agent through this adapter.
      if (!['Bash', 'Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebFetch', 'WebSearch'].includes(toolName)
        || !input || typeof input !== 'object' || Array.isArray(input)) return denied('Unsupported Claude tool');
      const requestId = crypto.randomUUID();
      const toolCallId = `claude-approval:${crypto.randomUUID()}`;
      const timeout = this.timeoutMs();
      const now = Date.now();
      const command = typeof input.command === 'string' ? input.command.slice(0, 1000) : undefined;
      const path = typeof input.file_path === 'string' ? input.file_path.slice(0, 1000)
        : typeof input.path === 'string' ? input.path.slice(0, 1000) : undefined;
      const ask: PermissionAsk = {
        type: 'permission', question: `Allow Claude to use ${toolName}?`,
        description: (command ?? path ?? toolName).slice(0, 1000),
        resource: toolName === 'Bash' ? 'shell-command' : 'file',
        action: toolName === 'Bash' ? 'execute' : ['Edit', 'Write'].includes(toolName) ? 'write' : 'read',
        risk: 'critical', allowedScopes: ['once'],
        metadata: { toolName, ...(command ? { command } : {}), ...(path ? { path } : {}) },
      };
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
