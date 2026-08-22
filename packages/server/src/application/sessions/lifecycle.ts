import type { Ask, AskAuthority } from '@prokopai/sdk';
import type { SessionWirePorts } from '../ports/delivery';
import type { SessionExecutionPort } from '../ports/execution';
import type {
  ControllerGatePort,
  SessionControlPort,
} from '../ports/control';
import type {
  AskAuthorityPort,
  PendingAskPort,
  PendingAskRecord,
  SessionRepositoryPort,
} from '../ports/session';
import { sendGateRejection } from './chat';

export interface SessionLifecycleDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
  control: SessionControlPort<Origin>;
  pendingAsks: PendingAskPort;
  askAuthority: AskAuthorityPort;
}

export interface SessionCreateInput {
  workspaceId?: string;
  preconfigId?: string;
  title?: string;
}

export interface SessionLifecycleApplication<Origin> {
  create(wire: SessionWirePorts<Origin>, origin: Origin, input: SessionCreateInput): Promise<void>;
  resume(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): Promise<void>;
  update(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; preconfigId?: string },
  ): Promise<void>;
  updateModel(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; modelId: string; providerId: string; variant?: string | null },
  ): void;
  close(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): void;
  reopen(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): void;
  remove(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string): void;
  rename(
    wire: SessionWirePorts<Origin>,
    origin: Origin,
    input: { sessionId: string; title?: string },
  ): void;
}

interface PendingAskSyncRequest {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  ask: Ask;
  requestId?: string;
  _originSessionId?: string;
  authority: AskAuthority;
}

const CONTROLLER_ONLY_AUTHORITY: AskAuthority = {
  visibilityScope: 'controller_only',
  resolutionMode: 'controller_only',
};

function buildSyncRequests(
  asks: PendingAskRecord[],
  askAuthority: AskAuthorityPort,
): PendingAskSyncRequest[] {
  const syncRequests: PendingAskSyncRequest[] = [];
  for (const ask of asks) {
    const hasRootContext = Boolean(ask.rootSessionId) && ask.rootSessionId !== ask.sessionId;
    const canonicalSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
    const askPayload = hasRootContext
      ? { ...ask.ask, _originSessionId: ask.sessionId }
      : ask.ask;
    const authority = askAuthority.getAuthorityForPendingAsk(ask.toolCallId);
    syncRequests.push({
      sessionId: canonicalSessionId,
      toolCallId: ask.toolCallId,
      toolName: ask.toolName,
      ask: askPayload as unknown as Ask,
      requestId: ask.requestId,
      ...(hasRootContext ? { _originSessionId: ask.sessionId } : {}),
      authority: authority ?? CONTROLLER_ONLY_AUTHORITY,
    });
  }
  return syncRequests;
}

export function createSessionLifecycleApplication<Origin>(
  deps: SessionLifecycleDeps<Origin>,
): SessionLifecycleApplication<Origin> {
  return {
    async create(wire, origin, input): Promise<void> {
      const sessionId = crypto.randomUUID();
      const workspaceAutoApprove = deps.repository.getWorkspaceAutoApproveSeverity(input.workspaceId || '');
      const session = deps.repository.createSession({
        id: sessionId,
        workspaceId: input.workspaceId || '',
        preconfigId: input.preconfigId || null,
        title: input.title || 'New Session',
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
        autoApproveSeverity: workspaceAutoApprove,
      });
      wire.actor.attachOriginToSession(origin, session.id);

      if (input.preconfigId) {
        const preconfig = await deps.repository.getPreconfigOrAgent(input.preconfigId);
        if (preconfig) {
          const updates: {
            selectedModel?: string;
            selectedProvider?: string;
            selectedVariant?: string | null;
            agentId?: string | null;
          } = {};
          if (preconfig.model) updates.selectedModel = preconfig.model;
          if (preconfig.provider) updates.selectedProvider = preconfig.provider;
          updates.selectedVariant = preconfig.variant ?? null;
          updates.agentId = deps.repository.isAgentSync(input.preconfigId) ? input.preconfigId : null;
          const updated = deps.repository.updateSession(sessionId, updates);
          wire.delivery.send(origin, { type: 'session.created', session: updated! });
          wire.delivery.broadcast({ type: 'session.created', session: updated! }, origin);
          return;
        }
      }

      wire.delivery.send(origin, { type: 'session.created', session });
      wire.delivery.broadcast({ type: 'session.created', session }, origin);
    },

    async resume(wire, origin, sessionId): Promise<void> {
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      wire.actor.attachOriginToSession(origin, session.id);

      const controlResult = deps.control.resumeControl(session.id, origin);

      const isRunning = deps.execution.isSessionActive(session.id);

      await deps.repository.reconcileCompaction(session.id);
      if (!isRunning) {
        deps.repository.reconcileOrphanedToolCalls(session.id);
        // No live execution can hold the running flag: clear any stale
        // running_at/subagent_status left by a crashed or wedged run so the
        // session cannot stay bricked in "running" forever.
        if (session.runningAt || session.subagentStatus === 'running') {
          deps.repository.updateSession(session.id, {
            runningAt: null,
            ...(session.subagentStatus === 'running' ? { subagentStatus: 'interrupted' } : {}),
          });
        }
      }

      const reconciledSession = deps.repository.getSession(sessionId);
      const transcriptPage = deps.repository.listLatestMessagesWithPartsPage(session.id, 50);

      wire.delivery.send(origin, {
        type: 'session.resumed',
        session: reconciledSession!,
        messages: transcriptPage.messages,
        transcript: {
          messages: transcriptPage.messages,
          pagination: transcriptPage.pagination,
        },
        usage: reconciledSession!.totalTokens ? {
          promptTokens: reconciledSession!.promptTokens ?? 0,
          completionTokens: reconciledSession!.completionTokens ?? 0,
          totalTokens: reconciledSession!.totalTokens ?? 0,
          cacheReadTokens: reconciledSession!.cacheReadTokens ?? 0,
          cacheWriteTokens: reconciledSession!.cacheWriteTokens ?? 0,
          noCacheTokens: reconciledSession!.noCacheTokens ?? 0,
        } : undefined,
        isRunning,
        control: controlResult.controlState,
      });

      if (controlResult.transitionReason) {
        wire.delivery.broadcastToSession(
          session.id,
          deps.control.buildControlUpdatedMessage(session.id, controlResult.transitionReason),
          origin,
        );
      }

      const queuedMessages = deps.repository.listQueuedMessages(sessionId);
      if (queuedMessages.length > 0) {
        wire.delivery.send(origin, {
          type: 'queue.list',
          sessionId,
          messages: queuedMessages,
        });
      }

      deps.pendingAsks.cleanupAllPendingAsks(deps.askAuthority.timeoutMs);

      const activePendingAsks = deps.pendingAsks.listPendingRequestsByRootSession(sessionId);
      const syncRequests = buildSyncRequests(activePendingAsks, deps.askAuthority);

      const otherPendingAsks = deps.pendingAsks.listAllPendingAsks().filter(
        (ask) =>
          ask.status === 'pending' &&
          ask.sessionId !== sessionId &&
          !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
      );
      syncRequests.push(...buildSyncRequests(otherPendingAsks, deps.askAuthority));

      wire.delivery.send(origin, {
        type: 'ask.pending_sync',
        sessionId,
        requests: syncRequests,
      });
    },

    async update(wire, origin, input): Promise<void> {
      const sessionId = input.sessionId;
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(sessionId, 'session.update', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }
      const updates: {
        preconfigId?: string;
        selectedVariant?: string | null;
        agentId?: string | null;
      } = {};
      if (input.preconfigId !== undefined) {
        updates.preconfigId = input.preconfigId;
        const preconfig = await deps.repository.getPreconfigOrAgent(input.preconfigId);
        updates.selectedVariant = preconfig?.variant ? preconfig.variant : null;
        updates.agentId = deps.repository.isAgentSync(input.preconfigId) ? input.preconfigId : null;
      }
      const updated = deps.repository.updateSession(sessionId, updates);
      wire.delivery.send(origin, { type: 'session.updated', session: updated! });
    },

    updateModel(wire, origin, input): void {
      const sessionId = input.sessionId;
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      const gate = deps.gate.checkControllerGate(sessionId, 'session.update_model', origin);
      if (gate) {
        sendGateRejection(wire, origin, gate);
        return;
      }
      const updated = deps.repository.updateSession(sessionId, {
        selectedModel: input.modelId,
        selectedProvider: input.providerId,
        selectedVariant: input.variant || null,
      });
      wire.delivery.send(origin, { type: 'session.updated', session: updated! });
    },

    close(wire, origin, sessionId): void {
      deps.repository.updateSession(sessionId, { status: 'closed' });
      wire.delivery.send(origin, { type: 'session.closed', sessionId });
    },

    reopen(wire, origin, sessionId): void {
      const session = deps.repository.getSession(sessionId);
      if (!session) {
        wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found' });
        return;
      }
      const updated = deps.repository.updateSession(sessionId, { status: 'active' });
      wire.delivery.send(origin, { type: 'session.reopened', session: updated! });
    },

    remove(wire, origin, sessionId): void {
      try {
        const session = deps.repository.getSession(sessionId);
        if (!session) {
          wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
          return;
        }
        deps.repository.deleteSession(sessionId);
        wire.delivery.send(origin, { type: 'session.deleted', sessionId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Delete failed';
        wire.delivery.send(origin, { type: 'error', code: 'delete_error', message, sessionId });
      }
    },

    rename(wire, origin, input): void {
      const sessionId = input.sessionId;
      try {
        const session = deps.repository.getSession(sessionId);
        if (!session) {
          wire.delivery.send(origin, { type: 'error', code: 'not_found', message: 'Session not found', sessionId });
          return;
        }
        const trimmedTitle = (input.title ?? '').trim();
        if (!trimmedTitle) {
          wire.delivery.send(origin, { type: 'error', code: 'invalid_title', message: 'Title cannot be empty', sessionId });
          return;
        }
        const updatedSession = deps.repository.updateSession(sessionId, {
          title: trimmedTitle,
          metadata: deps.repository.markManualSessionTitle(session.metadata),
        });
        wire.delivery.broadcastToSession(sessionId, { type: 'session.renamed', session: updatedSession! });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Rename failed';
        wire.delivery.send(origin, { type: 'error', code: 'rename_error', message, sessionId });
      }
    },
  };
}
