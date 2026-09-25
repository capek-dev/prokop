import { existsSync, realpathSync } from 'node:fs';
import type { AssistantMessage, Session, TextPart } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort, InterruptExecutionResult } from '@/application/ports/execution';
import { getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart, getMessageWithParts, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { CodexAppServer, CodexRequestError, codexObject, spawnCodexAppServer, type CodexConnection, type CodexNotification } from './app-server';
import { bindCodexThread, getCodexBinding, markCodexTurnPending, markCodexTurnCompleted, type CodexBinding } from './bindings';
import { getCodexModelSelection } from './models';

interface ActiveTurn {
  client: CodexAppServer;
  threadId: string;
  turnId: string | null;
  fail(error: Error): void;
}

export interface CodexExecutionDependencies {
  connect(): CodexConnection;
  version(): string;
}

export function codexCliVersion(): string {
  const result = Bun.spawnSync(['codex', '--version'], { stdout: 'pipe', stderr: 'ignore' });
  const version = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !/^codex-cli 0\.156\./.test(version)) {
    throw new Error('Codex CLI 0.156.x is required on the host');
  }
  return version;
}

export function codexCliAvailable(): boolean {
  try {
    codexCliVersion();
    return true;
  } catch {
    return false;
  }
}

const defaultDependencies: CodexExecutionDependencies = {
  connect: spawnCodexAppServer,
  version: codexCliVersion,
};

function id(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function workspaceRoot(session: Session): string {
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace || workspace.isVirtual || !workspace.path) throw new Error('Codex requires a physical workspace');
  let root = workspace.path;
  if (session.workspaceRootId) {
    const worktree = createManagedWorktreeRepository(getDatabase).get(session.workspaceRootId);
    if (worktree?.workspaceId !== session.workspaceId || worktree.state !== 'available') {
      throw new Error('Selected worktree is unavailable');
    }
    root = worktree.path;
  }
  if (!existsSync(root)) throw new Error('Workspace root is unavailable');
  return realpathSync(root);
}

/** Only a terminal turn containing our persisted client user ID proves the lost turn finished. */
async function reconcileTurn<Origin>(
  binding: CodexBinding, deps: CodexExecutionDependencies, wire: SessionWirePorts<Origin>,
  sessionId: string,
): Promise<void> {
  if (!binding.pendingUserId || !binding.pendingAssistantId) {
    throw new Error('Codex pending turn has no recovery identity');
  }
  const client = new CodexAppServer(deps.connect(), () => {});
  try {
    await client.initialize();
    const response = codexObject(await client.request('thread/read', {
      threadId: binding.threadId, includeTurns: true,
    }));
    const thread = codexObject(response?.thread);
    const turns = thread?.turns;
    if (id(thread?.id) !== binding.threadId || !Array.isArray(turns)
      || codexObject(thread?.status)?.type !== 'idle') {
      throw new Error('Codex thread is not ready for reconciliation');
    }
    const matches = turns.map(codexObject).filter(turn => Array.isArray(turn?.items)
      && turn.items.some(item => {
        const entry = codexObject(item);
        return entry?.type === 'userMessage' && entry.clientId === binding.pendingUserId;
      }));
    if (matches.length !== 1) throw new Error('Codex turn identity is not unique');
    const turn = matches[0]!;
    if (turn.itemsView !== 'full' || !['completed', 'failed', 'interrupted'].includes(String(turn.status))) {
      throw new Error('Codex turn is not terminal or its history is incomplete');
    }
    const assistant = getMessageWithParts(binding.pendingAssistantId);
    if (!assistant || assistant.message.sessionId !== sessionId || assistant.message.role !== 'assistant') {
      throw new Error('Codex transcript is unavailable');
    }
    const items = (turn.items as unknown[]).map(codexObject).filter(item => item?.type === 'agentMessage');
    if (items.some(item => typeof item?.text !== 'string')) throw new Error('Invalid Codex response history');
    const texts = items.map(item => item!.text as string);
    const existing = assistant.parts.filter(part => part.type === 'text');
    for (let index = 0; index < Math.max(existing.length, texts.length); index++) {
      const text = texts[index] ?? '';
      const part = existing[index];
      if (part) {
        const updated = updatePart(part.id, { text });
        if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
      } else {
        const created = createPart({ id: crypto.randomUUID(), messageId: assistant.message.id,
          type: 'text', text, createdAt: Date.now() }, sessionId);
        wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: created });
      }
    }
    const updated = updateMessage(assistant.message.id, {
      status: turn.status === 'failed' ? 'error' : turn.status as 'completed' | 'interrupted',
      completedAt: Date.now(),
      ...(turn.status === 'failed' ? { error: 'Codex turn failed' } : { error: undefined }),
    });
    if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
    markCodexTurnCompleted(sessionId);
  } finally {
    await client.close();
  }
}

/** One CLI process per active turn. Codex owns thread history, Prokop owns its transcript. */
export function createCodexExecution(deps: CodexExecutionDependencies = defaultDependencies): Pick<SessionExecutionPort,
  'sendMessage' | 'interruptSession' | 'isSessionActive'> {
  const active = new Map<string, ActiveTurn>();
  const starting = new Set<string>();
  return {
    isSessionActive: (sessionId) => active.has(sessionId) || starting.has(sessionId),
    async interruptSession(sessionId): Promise<InterruptExecutionResult> {
      const run = active.get(sessionId);
      if (!run) return { sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
      if (run.turnId) {
        await run.client.request('turn/interrupt', { threadId: run.threadId, turnId: run.turnId });
      } else {
        // The turn may already be running before turn/start responds. Closing
        // the owned transport prevents a second send until reconciliation.
        run.fail(new Error('Codex turn interrupted before its ID was received'));
        await run.client.close();
      }
      return { sessionId, success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
    },
    async sendMessage<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
      content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
      goalCondition?: string, goalMaxTurns?: number): Promise<void> {
      const session = getSession(sessionId);
      if (!session || session.harness !== 'codex-cli') {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Not a Codex CLI session', sessionId });
        return;
      }
      if (active.has(sessionId) || starting.has(sessionId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex turn already running', sessionId });
        return;
      }
      if (!content.trim() || attachments?.length || responseFormatId || goalCondition || goalMaxTurns !== undefined) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex CLI supports text messages only', sessionId });
        return;
      }
      starting.add(sessionId);
      let client: CodexAppServer | undefined;
      let assistant: AssistantMessage | undefined;
      let run: ActiveTurn | undefined;
      let phase = 'workspace validation';
      try {
        const root = workspaceRoot(session);
        phase = 'CLI version check';
        const version = deps.version();
        const binding = getCodexBinding(sessionId);
        if (binding && (binding.workspaceRoot !== root || binding.cliVersion !== version)) {
          throw new Error('Codex session root or CLI version changed; reopen with the original host');
        }
        if (binding?.pendingTurn) {
          phase = 'previous turn reconciliation';
          await reconcileTurn(binding, deps, wire, sessionId);
        }
        const user = createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
        const userPart = createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'text', text: content, createdAt: Date.now() }, sessionId);
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: user });
        wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: userPart });
        wire.actor.attachOriginToSession(origin, sessionId);
        assistant = createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant',
          status: 'streaming', modelId: 'codex-cli', providerId: 'codex-cli',
          tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() }) as AssistantMessage;
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });

        let resolveDone!: () => void;
        let rejectDone!: (error: Error) => void;
        const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
        // The process may fail before turn/start returns. Attach a rejection
        // observer immediately; the awaited completion still receives it.
        void done.catch(() => {});
        const pendingDeltas = new Map<string, { part: TextPart; text: string }>();
        let completed = false;
        const reportModel = (model: unknown): void => {
          if (typeof model !== 'string' || !model.trim()) return;
          const current = getSession(sessionId);
          if (current?.harness !== 'codex-cli') return;
          if (current.selectedModel !== model) {
            const updated = updateSession(sessionId, { selectedModel: model });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
          if (assistant && assistant.modelId !== model) {
            const updated = updateMessage(assistant.id, { modelId: model });
            if (updated?.role === 'assistant') {
              assistant = updated;
              wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
            }
          }
        };
        const notify = (event: CodexNotification): void => {
          const params = codexObject(event.params);
          if (!params || !run || params.threadId !== run.threadId) return;
          const turn = codexObject(params.turn);
          const eventTurnId = id(params.turnId) ?? id(turn?.id);
          if (event.method === 'turn/started' && eventTurnId) {
            run.turnId = eventTurnId;
            return;
          }
          if (!run.turnId || eventTurnId !== run.turnId || completed) return;
          if (event.method === 'model/rerouted') {
            reportModel(params.toModel);
            return;
          }
          if (event.method === 'item/agentMessage/delta') {
            const itemId = id(params.itemId);
            if (!itemId || typeof params.delta !== 'string') return;
            if (!assistant) return;
            let entry = pendingDeltas.get(itemId);
            if (!entry) {
              const part = createPart({ id: crypto.randomUUID(), messageId: assistant.id,
                type: 'text', text: '', createdAt: Date.now() }, sessionId) as TextPart;
              entry = { part, text: '' };
              pendingDeltas.set(itemId, entry);
              wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
            }
            entry.text += params.delta;
            updatePart(entry.part.id, { text: entry.text });
            wire.delivery.broadcastToSession(sessionId, { type: 'part.append', sessionId,
              partId: entry.part.id, field: 'text', delta: params.delta });
          } else if (event.method === 'item/completed') {
            const item = codexObject(params.item);
            if (item?.type === 'agentMessage' && id(item.id) && typeof item.text === 'string') {
              const entry = pendingDeltas.get(item.id as string);
              if (entry) {
                updatePart(entry.part.id, { text: item.text });
                wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId,
                  part: { ...entry.part, text: item.text } });
              } else {
                if (!assistant) return;
                const part = createPart({ id: crypto.randomUUID(), messageId: assistant.id,
                  type: 'text', text: item.text, createdAt: Date.now() }, sessionId);
                wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
              }
            }
          } else if (event.method === 'turn/completed') {
            completed = true;
            const status = turn?.status;
            if (status !== 'completed' && status !== 'interrupted' && status !== 'failed') {
              rejectDone(new Error('Invalid Codex turn status'));
            } else {
              if (assistant) {
                const updated = updateMessage(assistant.id, {
                  status: status === 'failed' ? 'error' : status, completedAt: Date.now(),
                });
                if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
              }
              markCodexTurnCompleted(sessionId);
              if (status === 'failed') rejectDone(new Error('Codex turn failed'));
              else resolveDone();
            }
          }
        };
        phase = 'app-server initialization';
        client = new CodexAppServer(deps.connect(), notify);
        await client.initialize();
        phase = binding ? 'thread resume' : 'thread creation';
        const selection = getCodexModelSelection(sessionId);
        const threadResponse = codexObject(await client.request(binding ? 'thread/resume' : 'thread/start',
          binding ? { threadId: binding.threadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
            ...(selection ? { model: selection.model } : {}) } : {
            cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
            ...(selection ? { model: selection.model } : {}),
          }));
        const threadId = id(codexObject(threadResponse?.thread)?.id);
        if (!threadId || (binding && binding.threadId !== threadId)) throw new Error('Invalid Codex thread');
        if (!binding) bindCodexThread({ sessionId, threadId, cliVersion: version, workspaceRoot: root });
        reportModel(threadResponse?.model ?? codexObject(threadResponse?.thread)?.model);
        run = { client, threadId, turnId: null, fail: rejectDone };
        active.set(sessionId, run);
        // Record uncertainty before sending: a process exit or restart must not
        // cause a possibly executed turn to be silently replayed.
        phase = 'turn start';
        markCodexTurnPending(sessionId, user.id, assistant.id);
        const response = codexObject(await client.request('turn/start', {
          threadId, clientUserMessageId: user.id, input: [{ type: 'text', text: content }], cwd: root,
          approvalPolicy: 'on-request',
          ...(selection ? { model: selection.model, effort: selection.effort } : {}),
        }));
        const turnId = id(codexObject(response?.turn)?.id);
        if (!turnId || (run.turnId && run.turnId !== turnId)) throw new Error('Invalid Codex turn');
        run.turnId = turnId;
        phase = 'turn execution';
        await Promise.race([done, client.disconnected]);
      } catch (error: unknown) {
        // Do not expose upstream messages, stderr, request payloads, or credentials.
        const rpcCode = error instanceof CodexRequestError && error.code !== null ? ` (RPC ${error.code})` : '';
        if (assistant) {
          const updated = updateMessage(assistant.id, { status: 'error', error: 'Codex turn failed', completedAt: Date.now() });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
        }
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
          message: getCodexBinding(sessionId)?.pendingTurn
            ? `Codex failed during ${phase}${rpcCode}. The turn may have run; it will not be resent until reconciled.`
            : `Codex failed during ${phase}${rpcCode}. Check the host CLI setup.`, sessionId });
      } finally {
        starting.delete(sessionId);
        if (run) active.delete(sessionId);
        if (client) await client.close();
      }
    },
  };
}
