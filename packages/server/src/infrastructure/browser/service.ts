import type { Ask, AskApi, PermissionAsk } from '@prokopai/sdk/tool';
import type { AskAuthority } from '@prokopai/sdk';
import type { BrowserRequestsPort } from '@/application/ports/browser';
import type { WorkspaceMcpResult } from '@/application/ports/mcp-tools';
import { shouldAutoApproveAsk } from '@/domains/permissions';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createPendingAsk, expirePermissionRequest, resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/infrastructure/sqlite/permissions';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { getAllClients, getConnectionById } from '@/transport/websocket/connection-registry';
import { getControllerConnections } from '@/transport/websocket/control-registry';
import { broadcastToSessionEvent, sendToAskTargetsEvent, sendToConnectionEvent } from '@/transport/websocket/broadcast';
import type { ConnectionId } from '@/transport/websocket/connection-id';
import { getProkopNotificationsApplication } from '@/adapters/prokop/notifications';
import { browserTools, validateBrowserInput } from './catalog';

const CONTROLLER: AskAuthority = { visibilityScope: 'controller_only', resolutionMode: 'controller_only' };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

interface Pending {
  requestId: string;
  sessionId: string;
  workspaceId: string;
  toolName: string;
  ask: Ask;
  authority: AskAuthority;
  connectionId?: ConnectionId;
  dbId?: string;
  key: string;
  check(): Promise<void>;
  finish(value: unknown, error?: Error): void;
}

/** One extension connection only. Ambiguity is an error, never a fan-out. */
export function browserConnection(): { clientId: string; connectionId: ConnectionId; capabilities: string[] } | null {
  const clients = [...getAllClients().values()].filter(client => client.clientType === 'extension'
    && client.capabilities.includes('browser_automation') && client.connectionIds.size > 0);
  if (clients.length !== 1) return null;
  const client = clients[0]!;
  // A reconnect can briefly overlap sockets. Select one and pin it for the entire call.
  const connectionId = [...client.connectionIds].at(-1)!;
  return { clientId: client.clientId, connectionId, capabilities: client.capabilities };
}

/** Host-owned bridge. The extension protocol stays independent of the calling harness. */
export class BrowserService implements BrowserRequestsPort {
  private readonly pending = new Map<string, Pending>();

  async getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null> {
    const pending = this.pending.get(toolCallId);
    return requestId && pending?.requestId === requestId ? pending.sessionId : null;
  }
  getAuthorityForPendingAsk(toolCallId: string): AskAuthority | undefined { return this.pending.get(toolCallId)?.authority; }
  acceptsConnection(toolCallId: string, connectionId: string): boolean {
    const pending = this.pending.get(toolCallId);
    return !!pending && (!pending.connectionId || pending.connectionId === connectionId);
  }
  connectionsChanged(): void {
    for (const pending of this.pending.values()) {
      if (pending.connectionId && !getConnectionById(pending.connectionId)) {
        pending.finish(undefined, new Error('Browser extension disconnected. The command was not retried.'));
      }
    }
  }

  async execute(name: string, input: Record<string, unknown>, sessionId: string, workspacePath: string,
    signal?: AbortSignal, authorized?: () => boolean | Promise<boolean>, timeoutMs?: number): Promise<WorkspaceMcpResult> {
    const tool = browserTools.find(tool => tool.definition.name === name);
    if (!tool) throw new Error('Unknown browser tool');
    validateBrowserInput(name, input);
    const session = getSession(sessionId);
    if (!session || getWorkspace(session.workspaceId)?.path !== workspacePath) throw new Error('Browser session unavailable');
    const check = async (): Promise<void> => {
      signal?.throwIfAborted();
      const allowed = !authorized || await authorized();
      // Authorization can await configuration I/O. Read session state afterwards.
      const current = getSession(sessionId);
      if (!allowed || !current || current.workspaceId !== session.workspaceId || current.harness !== session.harness
        || current.workspaceRootId !== session.workspaceRootId || current.status !== 'active'
        || current.permissionMode !== session.permissionMode
        || getWorkspace(current.workspaceId)?.path !== workspacePath) {
        throw new Error('Browser access is no longer available');
      }
      signal?.throwIfAborted();
    };
    await check();
    const connection = browserConnection();
    if (!connection) throw new Error('Connect exactly one Prokop Browser extension before using browser tools');
    const connectionAlive = (): void => {
      const current = getConnectionById(connection.connectionId);
      if (!current || current.clientId !== connection.clientId) throw new Error('Browser extension connection changed');
    };
    const ask = async (request: Ask): Promise<unknown> => {
      await check();
      connectionAlive();
      if (request.type === 'permission') {
        const key = JSON.stringify([connection.clientId, request.action, request.scope ?? 'browser']);
        const grant = matchGrant({ workspaceId: session.workspaceId, rootSessionId: sessionId,
          toolName: name, resource: 'browser', action: request.action, permissionKey: key });
        if (grant.matched && grant.grant?.scope === 'session' && grant.grant.boundRootSessionId === sessionId) return true;
        if (shouldAutoApproveAsk(request, session.permissionMode ?? 'standard')) return true;
        if (!getControllerConnections(sessionId).length) throw new Error('Browser access requires a connected session controller');
        return this.request(name, sessionId, session.workspaceId, request, CONTROLLER, key,
          getPermissionTimeoutMs(), check, signal);
      }
      if (request.type !== 'client_capability' || !connection.capabilities.includes(request.capability)) {
        throw new Error('Unsupported browser capability');
      }
      const authority: AskAuthority = { visibilityScope: 'global', resolutionMode: 'designated_clients',
        allowedResponderClientIds: [connection.clientId], requiredCapabilities: [request.capability] };
      return this.request(name, sessionId, session.workspaceId, request, authority, '',
        timeoutMs ?? tool.definition.timeout ?? 30_000, check, signal, connection.connectionId);
    };
    const result = await tool.execute(input, { ask: ask as AskApi });
    await check();
    const content: WorkspaceMcpResult['content'] = [{ type: 'text', text: JSON.stringify(
      result.success ? result.result ?? {} : { error: result.error ?? 'Browser command failed' }) }];
    for (const block of result.modelOutput ?? []) {
      if (block.type === 'image') content.push({ type: 'image', data: block.data, mimeType: block.mediaType });
    }
    return { content, isError: !result.success };
  }

  private request(toolName: string, sessionId: string, workspaceId: string, ask: Ask,
    authority: AskAuthority, key: string, timeout: number, check: () => Promise<void>,
    signal?: AbortSignal, connectionId?: ConnectionId): Promise<unknown> {
    signal?.throwIfAborted();
    const requestId = crypto.randomUUID();
    const toolCallId = `browser-request:${crypto.randomUUID()}`;
    const now = Date.now();
    // Only human permissions are replayable. Never persist extension commands for reconnect delivery.
    const dbId = ask.type === 'permission' ? createPendingAsk({ requestId, toolCallId, toolName, sessionId, rootSessionId: sessionId,
      workspaceId, ask, isPermission: true, status: 'pending', createdAt: now, expiresAt: now + timeout }) : undefined;
    return new Promise((resolve, reject) => {
      const abort = () => finish(undefined, new Error('Browser request cancelled. A dispatched command was not retried.'));
      const timer = setTimeout(() => finish(undefined, new Error('Browser request timed out')), timeout);
      const finish = (value: unknown, error?: Error): void => {
        if (!this.pending.delete(toolCallId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        let failure = error;
        try {
          if (error && dbId) expirePermissionRequest(dbId);
          broadcastToSessionEvent(sessionId, { type: 'ask.timeout', sessionId, toolCallId, requestId });
        } catch (cleanupError: unknown) {
          failure ??= cleanupError instanceof Error ? cleanupError : new Error('Browser request cleanup failed');
        }
        if (failure) reject(failure); else resolve(value);
      };
      this.pending.set(toolCallId, { requestId, sessionId, workspaceId, toolName, ask, authority, connectionId, dbId, key, check, finish });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      const message = { type: 'ask.request' as const, sessionId, toolCallId, toolName, requestId, authority, ask };
      try {
        if (connectionId) sendToConnectionEvent(connectionId, message);
        else {
          sendToAskTargetsEvent(sessionId, authority, message);
          getProkopNotificationsApplication().notifyPermissionRequired(requestId, sessionId);
        }
      } catch (error: unknown) { finish(undefined, error instanceof Error ? error : new Error('Browser request delivery failed')); }
    });
  }

  async resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
    const pending = this.pending.get(toolCallId);
    if (!pending || !requestId || pending.requestId !== requestId) return false;
    try {
      await pending.check();
      if (this.pending.get(toolCallId) !== pending) return false;
      const value = object(response);
      let result: unknown;
      if (pending.ask.type === 'permission') {
        const ask: PermissionAsk = pending.ask;
        const approved = value?.type === 'permission' && (value.grant === 'once' || value.grant === 'session')
          && ask.allowedScopes?.includes(value.grant) && value.duration === undefined && value.scope === undefined;
        getDatabase().transaction(() => {
          if (!resolvePermissionRequestByRequestId(requestId, approved ? 'approved' : 'denied', response)) {
            throw new Error('Browser permission expired');
          }
          if (approved && value.grant === 'session') createGrantFromOptions({ workspaceId: pending.workspaceId,
            toolName: pending.toolName, resource: 'browser', action: ask.action, permissionKey: pending.key,
            grantOptions: { scope: 'session', matcher: 'exact', action: ask.action, patterns: [pending.key],
              boundRootSessionId: pending.sessionId, duration: 30 * 60_000 } });
        })();
        result = !!approved;
      } else {
        if (pending.ask.type !== 'client_capability' || value?.type !== 'client_capability'
          || value.capability !== pending.ask.capability || !object(value.result)) throw new Error('Invalid browser extension response');
        const payload = object(value.result)!;
        if ('success' in payload && typeof payload.success !== 'boolean') throw new Error('Invalid browser success flag');
        if (pending.ask.capability === 'active_tab_read'
          && ['title', 'url', 'text'].some(key => key in payload && typeof payload[key] !== 'string')) {
          throw new Error('Invalid browser tab content');
        }
        result = payload;
      }
      pending.finish(result);
      return true;
    } catch (error: unknown) {
      pending.finish(undefined, error instanceof Error ? error : new Error('Browser request failed'));
      return false;
    }
  }
}

export const browserService = new BrowserService();
