import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { relative, isAbsolute, sep } from 'node:path';
import type { AssistantMessage, Session, TextPart } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort, InterruptExecutionResult } from '@/application/ports/execution';
import { getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart, deleteMessage, getMessageWithParts, listMessagesWithParts, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getAttachment, MAX_ATTACHMENT_SIZE, validateImageMime, type Attachment } from '@/infrastructure/sqlite/attachments';
import { getAttachmentDir } from '@/infrastructure/runtime/paths';
import { CodexAppServer, CodexRequestError, codexObject, type CodexConnection, type CodexNotification } from './app-server';
import { bindCodexThread, getCodexBinding, markCodexTurnPending, markCodexTurnStarted, markCodexGoalRequested, markCodexGoalUncertain, markCodexTurnCompleted, type CodexBinding } from './bindings';
import { getCodexModelSelection } from './models';
import { codexDeveloperInstructions, defaultCodexPreconfigId, type CodexInstructionSources } from './instructions';
import { codexApprovals } from './approvals';
import { CodexToolItems } from './tool-items';
import { createPretoolChannel, verifyPretoolHook, type PretoolChannel } from './pretool-hook';
import { classifyCodexHook } from './hook-policy';
import { parseCodexGoal, publishCodexGoal, validGoalBudget } from './goal';
import { parseCodexContextUsage, publishCodexContextUsage } from './usage';
import { createCodexMemoryTools, type CodexMemoryBridge } from './memory-tools';
import { createCodexSessionSearchTools, type CodexSessionSearchBridge } from './session-search-tools';
import { createCodexAgentSkillTools, type CodexAgentSkillBridge } from './agent-skill-tools';
import { applyRollback, clearRollbackIntent, getRollbackIntent, readRollbackHistory, readTurnIds, sameTurns, saveRollbackIntent, setRollbackPhase } from './rollback';
import { forkCodexSession } from './fork';
import { codexCliVersion } from './version';

export { codexCliVersion } from './version';

interface ActiveTurn {
  client: CodexAppServer;
  threadId: string;
  turnId: string | null;
  fail(error: Error): void;
  goal: boolean;
  stopRequested: boolean;
  isTurnCompleted(): boolean;
  activationSettled: Promise<void>;
  resolveActivation(): void;
  stop?: Promise<InterruptExecutionResult>;
  pauseGoal?(goal: import('@prokopai/sdk').CodexGoalState): void;
}

export interface CodexExecutionDependencies {
  connect(): CodexConnection;
  version(): string;
  prepareHook?: typeof createPretoolChannel;
  goalIdleTimeoutMs?: number;
  instructions: CodexInstructionSources;
  memoryTools?: CodexMemoryBridge;
  sessionSearch?: CodexSessionSearchBridge;
  agentSkills?: CodexAgentSkillBridge;
}

export function codexCliAvailable(): boolean {
  try {
    codexCliVersion();
    return true;
  } catch {
    return false;
  }
}

function id(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function resolveImages(session: Session, references: Array<{ id: string; kind: string }>): Attachment[] | null {
  const directory = getAttachmentDir(session.workspaceId, session.id);
  const images: Attachment[] = [];
  for (const reference of references) {
    if (reference?.kind !== 'image' || typeof reference.id !== 'string') return null;
    const image = getAttachment(session.id, reference.id);
    if (!image || image.workspaceId !== session.workspaceId || image.kind !== 'image'
      || !validateImageMime(image.mimeType) || image.sizeBytes < 1 || image.sizeBytes > MAX_ATTACHMENT_SIZE) return null;
    try {
      const stat = lstatSync(image.absolutePath);
      const path = realpathSync(image.absolutePath);
      const offset = relative(realpathSync(directory), path);
      if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
        || !stat.isFile() || stat.isSymbolicLink() || stat.size !== image.sizeBytes) return null;
      images.push({ ...image, absolutePath: path });
    } catch { return null; }
  }
  return images;
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
    const history = turns.map(codexObject);
    const roots = history.filter(turn => Array.isArray(turn?.items)
      && turn.items.some(item => {
        const entry = codexObject(item);
        return entry?.type === 'userMessage' && entry.clientId === binding.pendingUserId;
      }));
    if (roots.length !== 1) throw new Error('Codex turn identity is not unique');
    const root = roots[0]!;
    const metadata = codexObject(getSession(sessionId)?.metadata);
    const persistedGoal = codexObject(metadata?.codexGoal);
    const pendingGoal = codexObject(metadata?.codexGoalPending);
    if (binding.goalRequested && !persistedGoal &&
      (!pendingGoal || typeof pendingGoal.objective !== 'string' || !pendingGoal.objective.trim()
        || !validGoalBudget(pendingGoal.tokenBudget))) {
      throw new Error('Codex goal activation has no recovery identity');
    }
    let turn = root;
    let recoveredGoal: ReturnType<typeof parseCodexGoal> = null;
    if (binding.goalRequested) {
      const goalResponse = codexObject(await client.request('thread/goal/get', { threadId: binding.threadId }));
      if (!goalResponse || !Object.hasOwn(goalResponse, 'goal')) throw new Error('Codex goal state is unavailable');
      if (goalResponse.goal !== null) {
        recoveredGoal = parseCodexGoal(goalResponse.goal, binding.threadId);
        if (!recoveredGoal || recoveredGoal.status === 'active'
          || recoveredGoal.objective !== (persistedGoal?.objective ?? pendingGoal?.objective)
          || recoveredGoal.tokenBudget !== (persistedGoal?.tokenBudget ?? pendingGoal?.tokenBudget)) {
          throw new Error('Codex goal is not safe to reconcile');
        }
      } else if (persistedGoal || !pendingGoal) {
        throw new Error('Codex goal disappeared before recovery');
      }
      if (!binding.pendingTurnId || !binding.goalRootTurnId || root.id !== binding.goalRootTurnId) {
        throw new Error('Codex goal turn identity is unavailable');
      }
      const rootIndex = history.indexOf(root);
      const pendingIndex = history.findIndex(entry => entry?.id === binding.pendingTurnId);
      if (pendingIndex < rootIndex || pendingIndex !== history.length - 1
        || history.filter(entry => entry?.id === binding.pendingTurnId).length !== 1) {
        throw new Error('Codex goal history has untracked turns');
      }
      const local = listMessagesWithParts(sessionId);
      const userIndex = local.findIndex(entry => entry.message.id === binding.pendingUserId);
      const assistants = local.slice(userIndex + 1);
      if (userIndex < 0 || assistants.length !== pendingIndex - rootIndex + 1
        || assistants.some(entry => entry.message.role !== 'assistant')
        || assistants.at(-1)?.message.id !== binding.pendingAssistantId) {
        throw new Error('Codex goal transcript is incomplete');
      }
      for (let index = rootIndex; index <= pendingIndex; index++) {
        const entry = history[index];
        const previous = assistants[index - rootIndex]?.message;
        if (entry?.itemsView !== 'full' || !['completed', 'failed', 'interrupted'].includes(String(entry.status))
          || (index < pendingIndex && previous?.role === 'assistant' && previous.status === 'streaming')) {
          throw new Error('Codex goal history is not terminal');
        }
      }
      if (!recoveredGoal && pendingIndex !== rootIndex) {
        throw new Error('Codex goal activation has untracked turns');
      }
      turn = history[pendingIndex]!;
    } else if (history.indexOf(root) !== history.length - 1) {
      throw new Error('Codex turn history has untracked turns');
    }
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
    if (recoveredGoal) publishCodexGoal(getSession(sessionId)!, recoveredGoal, wire.delivery);
    else if (pendingGoal) {
      const latest = getSession(sessionId);
      if (!latest || latest.harness !== 'codex-cli') throw new Error('Codex session disappeared');
      const { codexGoalPending: _pending, ...rest } = codexObject(latest.metadata) ?? {};
      const updatedSession = updateSession(sessionId, { metadata: rest });
      if (updatedSession) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updatedSession });
    }
    markCodexTurnCompleted(sessionId);
  } finally {
    await client.close();
  }
}

const SAFE_EDIT_ERRORS = new Set([
  'Codex session is unavailable or busy', 'Codex edit requires nonempty text',
  'Codex thread binding is unavailable or changed', 'Codex goal requires recovery',
  'Another Codex rollback requires recovery', 'Codex edit turn requires recovery',
  'Codex turn requires reconciliation before rollback', 'Codex thread history is unavailable',
  'Codex transcript does not match turn history', 'Codex turn identity is incomplete',
  'Codex turn identity is ambiguous', 'Invalid Codex rollback target',
  'Codex edit attachment is unavailable', 'Codex rollback target has no turn',
  'Codex rollback history is unavailable', 'Codex rollback history is incomplete',
  'Codex rollback history is ambiguous', 'Codex rollback outcome is uncertain',
  'Codex thread is not idle after resume', 'Codex rollback is not pending', 'Codex rollback target disappeared',
  'Codex edit text is unavailable', 'Codex transcript deletion failed',
]);

const SAFE_FORK_ERRORS = new Set([
  'Codex session is unavailable or busy', 'Codex thread binding is unavailable or changed',
  'Codex history requires recovery before fork', 'A Codex fork has an uncertain outcome; do not retry it',
  'Codex thread is not idle after resume', 'Codex goal history cannot be forked',
  'Codex thread history is unavailable', 'Codex transcript does not match turn history',
  'Codex turn identity is incomplete', 'Codex turn identity is ambiguous',
  'Codex fork requires a completed assistant response', 'Codex fork of image history is not supported',
]);

/** One CLI process per active turn. Codex owns thread history, Prokop owns its transcript. */
export function createCodexExecution(deps: CodexExecutionDependencies): Pick<SessionExecutionPort,
  'sendMessage' | 'interruptSession' | 'isSessionActive' | 'editMessage' | 'revert' | 'fork'> {
  const active = new Map<string, ActiveTurn>();
  const starting = new Set<string>();
  const resubmitting = new Map<string, string>();
  async function rollback<Origin>(sessionId: string, operation: 'edit' | 'revert', targetMessageId: string,
    content: string | null, wire?: SessionWirePorts<Origin>): Promise<import('@/application/ports/execution').RevertExecutionResult | null> {
    const session = getSession(sessionId);
    if (!session || session.harness !== 'codex-cli' || session.status === 'closed'
      || active.has(sessionId) || starting.has(sessionId)) throw new Error('Codex session is unavailable or busy');
    if (operation === 'edit' && (!content?.trim() || content !== content.trim())) {
      throw new Error('Codex edit requires nonempty text');
    }
    const root = workspaceRoot(session);
    const version = deps.version();
    const binding = getCodexBinding(sessionId);
    if (!binding || binding.workspaceRoot !== root || binding.cliVersion !== version) {
      throw new Error('Codex thread binding is unavailable or changed');
    }
    const metadata = codexObject(session.metadata);
    if (codexObject(metadata?.codexGoal)?.status === 'active' || metadata?.codexGoalPending
      || binding.goalRequested) throw new Error('Codex goal requires recovery');
    let intent = getRollbackIntent(sessionId);
    if (intent && (intent.operation !== operation || intent.targetMessageId !== targetMessageId
      || intent.content !== content)) throw new Error('Another Codex rollback requires recovery');
    if (intent?.phase === 'sent') {
      if (binding.pendingTurn) {
        if (!wire) throw new Error('Codex edit turn requires recovery');
        await reconcileTurn(binding, deps, wire, sessionId);
      }
      clearRollbackIntent(sessionId);
      return null;
    }
    if (binding.pendingTurn) throw new Error('Codex turn requires reconciliation before rollback');
    if (intent?.phase === 'ready') return null;
    starting.add(sessionId);
    let client: CodexAppServer | undefined;
    try {
      client = new CodexAppServer(deps.connect(), () => {});
      await client.initialize();
      // A new app-server connection can read persisted history while the thread
      // is notLoaded. Resume the bound thread before requiring idle history.
      const resumed = codexObject(await client.request('thread/resume', {
        threadId: binding.threadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
      }));
      const resumedThread = codexObject(resumed?.thread);
      if (resumedThread?.id !== binding.threadId || codexObject(resumedThread.status)?.type !== 'idle') {
        throw new Error('Codex thread is not idle after resume');
      }
      if (!intent) {
        const ids = await readRollbackHistory(client, binding);
        const local = listMessagesWithParts(sessionId);
        const index = local.findIndex(entry => entry.message.id === targetMessageId);
        const target = local[index];
        if (!target || (operation === 'edit' && (target.message.role !== 'user'
          || !target.parts.some(part => part.type === 'text')))) throw new Error('Invalid Codex rollback target');
        if (operation === 'edit' && !resolveImages(session, target.parts.filter(part => part.type === 'image')
          .map(part => ({ id: /\/attachments\/([^/]+)\/content/.exec(part.url ?? '')?.[1] ?? '', kind: 'image' })))) {
          throw new Error('Codex edit attachment is unavailable');
        }
        const firstUser = operation === 'revert' && index === 0 && target.message.role === 'user';
        const userIndex = operation === 'edit' || firstUser ? index / 2 : (index + 1) / 2;
        if (!Number.isInteger(userIndex) || !ids[userIndex]
          || operation === 'revert' && !firstUser && target.message.role !== 'assistant') {
          throw new Error('Codex rollback target has no turn');
        }
        intent = { sessionId, operation, targetMessageId,
          content, beforeTurnId: ids[userIndex]!, turnIds: ids, phase: 'rollback' };
        saveRollbackIntent(intent);
      } else {
        const existing = await readTurnIds(client, binding.threadId);
        const prefix = intent.turnIds.slice(0, intent.turnIds.indexOf(intent.beforeTurnId));
        if (sameTurns(existing, prefix)) return applyRollback(intent);
        // A request whose response was lost is never issued twice.
        throw new Error('Codex rollback outcome is uncertain');
      }
      await client.request('thread/revert', { threadId: binding.threadId, beforeTurnId: intent.beforeTurnId });
      const actual = await readTurnIds(client, binding.threadId);
      const prefix = intent.turnIds.slice(0, intent.turnIds.indexOf(intent.beforeTurnId));
      if (!sameTurns(actual, prefix)) throw new Error('Codex rollback outcome is uncertain');
      return applyRollback(intent);
    } finally {
      starting.delete(sessionId);
      if (client) await client.close();
    }
  }
  const execution: Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive' | 'editMessage' | 'revert' | 'fork'> = {
    isSessionActive: (sessionId) => active.has(sessionId) || starting.has(sessionId),
    async interruptSession(sessionId): Promise<InterruptExecutionResult> {
      const run = active.get(sessionId);
      if (!run) return { sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
      if (run.stop) return run.stop;
      run.stopRequested = true;
      run.stop = (async (): Promise<InterruptExecutionResult> => {
        codexApprovals.cancelSession(sessionId);
        if (!run.turnId) {
          // The turn may already be running before turn/start responds.
          run.fail(new Error('Codex turn interrupted before its ID was received'));
          await run.client.close();
          return { sessionId, success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
        }
        try {
          if (run.goal) {
            // Activation may be in flight. Its response must not publish active after Stop pauses it.
            await run.activationSettled;
            if (active.get(sessionId) !== run) {
              return { sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
            }
            if (getCodexBinding(sessionId)?.goalRequested) {
              const response = codexObject(await run.client.request('thread/goal/set', {
                threadId: run.threadId, status: 'paused',
              }));
              const goal = parseCodexGoal(response?.goal, run.threadId);
              if (!goal || goal.status !== 'paused') throw new Error('Codex goal could not be paused');
              run.pauseGoal?.(goal);
            }
          }
          if (run.turnId && !run.isTurnCompleted()) {
            await run.client.request('turn/interrupt', { threadId: run.threadId, turnId: run.turnId });
          }
          return { sessionId, success: true, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
        } catch {
          run.fail(new Error('Codex interruption could not be confirmed'));
          await run.client.close();
          return { sessionId, success: false, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
        }
      })();
      return run.stop;
    },
    async sendMessage<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
      content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
      goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number): Promise<void> {
      const session = getSession(sessionId);
      if (!session || session.harness !== 'codex-cli') {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Not a Codex CLI session', sessionId });
        return;
      }
      if (active.has(sessionId) || starting.has(sessionId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex turn already running', sessionId });
        return;
      }
      const rollback = getRollbackIntent(sessionId);
      const reuseId = resubmitting.get(sessionId);
      if (rollback && (rollback.phase !== 'ready' || rollback.operation !== 'edit'
        || rollback.targetMessageId !== reuseId)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
          message: 'Codex rollback requires reconciliation before another send', sessionId });
        return;
      }
      if (goalTokenBudget !== undefined && (!validGoalBudget(goalTokenBudget)
        || typeof goalCondition !== 'string' || !goalCondition.trim()
        || goalCondition.trim() !== content.trim() || goalMaxTurns !== undefined || attachments?.length)) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
          message: 'Invalid Codex goal or token budget', sessionId });
        return;
      }
      if ((!content.trim() && !attachments?.length) || responseFormatId
        || (goalCondition !== undefined && goalTokenBudget === undefined) || goalMaxTurns !== undefined) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex CLI supports text and image messages only', sessionId });
        return;
      }
      const existingUser = reuseId ? getMessageWithParts(reuseId) : null;
      if (reuseId && (!existingUser || existingUser.message.sessionId !== sessionId
        || existingUser.message.role !== 'user' || !existingUser.parts.some(part => part.type === 'text'
          && part.text === content))) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex edit target is unavailable', sessionId });
        return;
      }
      const references = reuseId ? existingUser!.parts.filter(part => part.type === 'image').map(part => {
        const id = /\/attachments\/([^/]+)\/content/.exec(part.url ?? '')?.[1] ?? '';
        return { id, kind: 'image' };
      }) : attachments ?? [];
      const images = resolveImages(session, references);
      if (!images) {
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session', message: 'Codex image attachment is unavailable or unsupported', sessionId });
        return;
      }
      starting.add(sessionId);
      let client: CodexAppServer | undefined;
      let hookChannel: PretoolChannel | undefined;
      let assistant: AssistantMessage | undefined;
      let run: ActiveTurn | undefined;
      let toolItems: CodexToolItems | undefined;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      let phase = 'workspace validation';
      try {
        const root = workspaceRoot(session);
        const workspace = getWorkspace(session.workspaceId);
        const sources = deps.instructions;
        if (!workspace) throw new Error('Codex workspace is unavailable');
        const preconfigId = session.preconfigId || defaultCodexPreconfigId(workspace, await sources.listPreconfigs());
        if (!preconfigId) throw new Error('Codex requires a preconfig');
        const preconfig = await sources.getPreconfig(preconfigId);
        if (!preconfig) throw new Error('Codex preconfig is unavailable');
        const agentDir = session.agentId && session.agentId !== preconfigId
          ? null : await sources.getAgentDirectory(preconfigId);
        const memoryDefinitions = deps.memoryTools?.definitions() ?? [];
        const memoryToolNames = memoryDefinitions.filter(definition =>
          definition.type === 'function' && (definition.name === 'memory'
            && workspace.settings.memory?.enabled === true || definition.name === 'agent_memory' && !!agentDir))
          .map(definition => definition.name);
        const searchDefinitions = deps.sessionSearch?.definitions() ?? [];
        const searchToolNames = workspace.settings.sessionSearch?.enabled === true
          ? searchDefinitions.filter(definition => definition.type === 'function'
            && definition.name === 'session_search').map(definition => definition.name) : [];
        const skillDefinitions = agentDir ? deps.agentSkills?.definitions() ?? [] : [];
        const skillToolNames = skillDefinitions.filter(definition =>
          definition.type === 'function' && definition.name === 'agent_skill_manage').map(definition => definition.name);
        const instructions = await codexDeveloperInstructions(workspace, root, preconfig, {
          ...sources, getAgentDirectory: async () => agentDir,
        }, [...memoryToolNames, ...searchToolNames, ...skillToolNames]);
        if (!session.preconfigId) {
          const updated = updateSession(sessionId, { preconfigId,
            agentId: agentDir ? preconfigId : null });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        phase = 'CLI version check';
        const version = deps.version();
        const binding = getCodexBinding(sessionId);
        if (binding && (binding.workspaceRoot !== root || binding.cliVersion !== version)) {
          throw new Error('Codex session root or CLI version changed; reopen with the original host');
        }
        const persistedGoal = codexObject(codexObject(getSession(sessionId)?.metadata)?.codexGoal);
        if (binding?.pendingTurn) {
          if (reuseId) throw new Error('Codex edit turn requires reconciliation');
          phase = 'previous turn reconciliation';
          await reconcileTurn(binding, deps, wire, sessionId);
        } else if (persistedGoal?.status === 'active' || binding?.goalRequested) {
          throw new Error('An active Codex goal requires recovery before another send');
        }
        const user = existingUser?.message ?? createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
        if (!reuseId) wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: user });
        if (!reuseId && content.trim()) {
          const userPart = createPart({ id: crypto.randomUUID(), messageId: user.id,
            type: 'text', text: content, createdAt: Date.now() }, sessionId);
          wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: userPart });
        }
        const imagePartStart = Date.now() + (content.trim() ? 1 : 0);
        for (const [index, image] of (reuseId ? [] : images).entries()) {
          const part = createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'image',
            url: `/api/sessions/${sessionId}/attachments/${image.id}/content?key=${image.accessKey}`,
            mimeType: image.mimeType, createdAt: imagePartStart + index }, sessionId);
          wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
        }
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
        let goalStatus: string | null = null;
        let started = false;
        let turnIdentityRecorded = false;
        let resolveStarted!: () => void;
        const turnStarted = new Promise<void>(resolve => { resolveStarted = resolve; });
        const awaitContinuation = (): void => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => rejectDone(new Error('Codex goal continuation did not start')),
            deps.goalIdleTimeoutMs ?? 60_000);
        };
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
          if (event.method === 'thread/tokenUsage/updated') {
            if (!run.turnId || eventTurnId !== run.turnId || completed) return;
            const usage = parseCodexContextUsage(params.tokenUsage);
            if (usage) publishCodexContextUsage(sessionId, usage, wire.delivery);
            return;
          }
          if (event.method === 'thread/goal/cleared' && goalTokenBudget !== undefined) {
            publishCodexGoal(session, null, wire.delivery);
            rejectDone(new Error('Codex goal was cleared before completion'));
            return;
          }
          if (event.method === 'thread/goal/updated' && goalTokenBudget !== undefined) {
            const goal = parseCodexGoal(params.goal, run.threadId);
            if (!goal) { rejectDone(new Error('Invalid Codex goal update')); return; }
            if (run.stopRequested && goalStatus === 'paused' && goal.status === 'active') {
              markCodexGoalUncertain(sessionId);
              rejectDone(new Error('Codex goal resumed after Stop'));
              return;
            }
            goalStatus = goal.status;
            publishCodexGoal(session, goal, wire.delivery);
            if (completed && goalStatus !== 'active') {
              clearTimeout(idleTimer);
              markCodexTurnCompleted(sessionId);
              resolveDone();
            } else if (completed && goalStatus === 'active') {
              awaitContinuation();
            }
            return;
          }
          if (event.method === 'turn/started' && eventTurnId) {
            if (run.turnId && run.turnId !== eventTurnId) {
              if (run.stopRequested && run.goal) {
                markCodexGoalUncertain(sessionId);
                rejectDone(new Error('Codex continuation started after Stop'));
                return;
              }
              if (goalTokenBudget === undefined || !completed || goalStatus !== 'active') {
                rejectDone(new Error('Unexpected Codex continuation turn'));
                return;
              }
              clearTimeout(idleTimer);
              codexApprovals.cancelSession(sessionId);
              toolItems?.finish();
              toolItems = undefined;
              pendingDeltas.clear();
              assistant = createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant',
                status: 'streaming', modelId: 'codex-cli', providerId: 'codex-cli',
                tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() }) as AssistantMessage;
              markCodexTurnStarted(sessionId, eventTurnId, assistant.id, true);
              turnIdentityRecorded = true;
              wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });
              completed = false;
            }
            if (!turnIdentityRecorded && assistant) {
              markCodexTurnStarted(sessionId, eventTurnId, assistant.id, false);
              turnIdentityRecorded = true;
            }
            run.turnId = eventTurnId;
            started = true;
            resolveStarted();
            return;
          }
          if (!run.turnId || eventTurnId !== run.turnId || completed) return;
          if (event.method === 'item/started' || event.method === 'item/completed') {
            if (assistant) {
              toolItems ??= new CodexToolItems(sessionId, assistant.id, run.turnId, wire.delivery);
              if (event.method === 'item/started') toolItems.started(params.item);
              else toolItems.completed(params.item);
            }
          }
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
            toolItems?.finish();
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
              if (goalTokenBudget === undefined || (goalStatus !== 'active' && goalStatus !== null)) {
                markCodexTurnCompleted(sessionId);
                if (status === 'failed') rejectDone(new Error('Codex turn failed'));
                else resolveDone();
              } else if (goalStatus === 'active') {
                awaitContinuation();
              }
            }
          }
        };
        const memoryTools = deps.memoryTools && createCodexMemoryTools({
          bridge: deps.memoryTools, definitions: memoryDefinitions,
          sessionId, workspaceId: session.workspaceId, root, agentDir,
          isActive: turnId => !!run && active.get(sessionId) === run && run.turnId === turnId
            && !completed && !run.stopRequested,
          authorizeRoot: () => {
            try {
              const current = getSession(sessionId);
              return !!current && current.preconfigId === preconfigId && workspaceRoot(current) === root;
            } catch { return false; }
          },
          ask: request => codexApprovals.requestMemory(request, sessionId, session.workspaceId, wire.delivery),
        });
        const sessionSearch = deps.sessionSearch && createCodexSessionSearchTools({
          bridge: deps.sessionSearch, definitions: searchDefinitions,
          sessionId, workspaceId: session.workspaceId, preconfigId, agentDir,
          isActive: turnId => !!run && active.get(sessionId) === run && run.turnId === turnId
            && !completed && !run.stopRequested,
          authorizeRoot: () => {
            try {
              const current = getSession(sessionId);
              return !!current && current.preconfigId === preconfigId && workspaceRoot(current) === root;
            } catch { return false; }
          },
          ask: request => codexApprovals.requestSessionSearch(request, sessionId, session.workspaceId, wire.delivery),
        });
        const agentSkills = deps.agentSkills && createCodexAgentSkillTools({
          bridge: deps.agentSkills, definitions: skillDefinitions,
          sessionId, workspaceId: session.workspaceId, preconfigId, agentDir,
          isActive: turnId => !!run && active.get(sessionId) === run && run.turnId === turnId
            && !completed && !run.stopRequested,
          authorizeRoot: () => {
            try {
              const current = getSession(sessionId);
              return !!current && current.preconfigId === preconfigId && workspaceRoot(current) === root;
            } catch { return false; }
          },
        });
        const dynamicTools = [...(memoryTools?.definitions ?? []), ...(sessionSearch?.definitions ?? []),
          ...(agentSkills?.definitions ?? [])];
        phase = 'Codex permission hook';
        hookChannel = await deps.prepareHook?.(async call => {
          if (!run?.turnId || completed || call.session_id !== run.threadId || call.turn_id !== run.turnId
            || call.cwd !== root) return false;
          const ask = classifyCodexHook(call, root);
          if (ask === undefined) return false;
          if (ask === null) return true;
          const input = codexObject(call.tool_input);
          return codexApprovals.requestHook({ ...ask, allowedScopes: ['once'] },
            call.tool_name as 'Bash' | 'apply_patch', input?.command as string, call.tool_use_id,
            run.threadId, run.turnId, sessionId, root, session.workspaceId, wire.delivery);
        });
        phase = 'app-server initialization';
        client = new CodexAppServer(hookChannel ? hookChannel.connect() : deps.connect(), notify, (method, params) => {
          if (!run?.turnId || completed) return Promise.resolve({ decision: 'decline' });
          return codexApprovals.request(method, params, run.threadId, run.turnId,
            sessionId, root, session.workspaceId, wire.delivery);
        }, async params => {
          const request = codexObject(params);
          if (!run || request?.threadId !== run.threadId) {
            return { success: false, contentItems: [{ type: 'inputText', text: 'Dynamic tool unavailable' }] };
          }
          if (request.tool === 'session_search' && sessionSearch) return sessionSearch.call(params);
          if (request.tool === 'agent_skill_manage' && agentSkills) return agentSkills.call(params);
          if (memoryTools) return memoryTools.call(params);
          return { success: false, contentItems: [{ type: 'inputText', text: 'Dynamic tool unavailable' }] };
        }, dynamicTools.length > 0);
        await client.initialize();
        if (hookChannel) await verifyPretoolHook(client);
        phase = binding ? 'thread resume' : 'thread creation';
        const selection = getCodexModelSelection(sessionId);
        const threadResponse = codexObject(await client.request(binding ? 'thread/resume' : 'thread/start',
          binding ? { threadId: binding.threadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
            ...(selection ? { model: selection.model } : {}), developerInstructions: instructions } : {
            cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
            ...(selection ? { model: selection.model } : {}), developerInstructions: instructions,
            ...(dynamicTools.length ? { dynamicTools } : {}),
          }));
        const threadId = id(codexObject(threadResponse?.thread)?.id);
        if (!threadId || (binding && binding.threadId !== threadId)) throw new Error('Invalid Codex thread');
        if (!binding) bindCodexThread({ sessionId, threadId, cliVersion: version, workspaceRoot: root });
        reportModel(threadResponse?.model ?? codexObject(threadResponse?.thread)?.model);
        let resolveActivation!: () => void;
        const activationSettled = new Promise<void>(resolve => { resolveActivation = resolve; });
        run = { client, threadId, turnId: null, fail: rejectDone, goal: goalTokenBudget !== undefined,
          stopRequested: false, isTurnCompleted: () => completed, activationSettled, resolveActivation,
          pauseGoal: goal => {
            goalStatus = goal.status;
            publishCodexGoal(session, goal, wire.delivery);
            if (completed) { markCodexTurnCompleted(sessionId); resolveDone(); }
          },
        };
        active.set(sessionId, run);
        // Record uncertainty before sending: a process exit or restart must not
        // cause a possibly executed turn to be silently replayed.
        phase = 'turn start';
        getDatabase().transaction(() => {
          markCodexTurnPending(sessionId, user.id, assistant!.id);
          if (reuseId) setRollbackPhase(sessionId, 'sent');
        })();
        const response = codexObject(await client.request('turn/start', {
          threadId, clientUserMessageId: user.id,
          input: [...(content.trim() ? [{ type: 'text', text: content }] : []),
            ...images.map(image => ({ type: 'localImage', path: image.absolutePath }))], cwd: root,
          approvalPolicy: 'on-request',
          ...(selection ? { model: selection.model, effort: selection.effort } : {}),
        }));
        const turnId = id(codexObject(response?.turn)?.id);
        if (!turnId || (run.turnId && run.turnId !== turnId)) throw new Error('Invalid Codex turn');
        run.turnId = turnId;
        if (!turnIdentityRecorded) {
          markCodexTurnStarted(sessionId, turnId, assistant.id, false);
          turnIdentityRecorded = true;
        }
        if (goalTokenBudget !== undefined) {
          phase = 'goal activation';
          try {
            await Promise.race([turnStarted, done.then(() => { throw new Error('Codex turn ended before goal activation'); }), client.disconnected]);
            if (!started || completed) throw new Error('Codex turn ended before goal activation');
            if (!run.stopRequested) {
              // Persist intent and retire earlier goal metadata together, before the RPC can run.
              const pendingGoal = getDatabase().transaction(() => {
                markCodexGoalRequested(sessionId);
                const latest = getSession(sessionId);
                if (!latest || latest.harness !== 'codex-cli') throw new Error('Codex session disappeared');
                return updateSession(sessionId, { metadata: {
                  ...(codexObject(latest.metadata) ?? {}), codexGoal: null,
                  codexGoalPending: { objective: goalCondition, tokenBudget: goalTokenBudget },
                } });
              })();
              if (!pendingGoal) throw new Error('Codex session disappeared');
              wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: pendingGoal });
              const goalResponse = codexObject(await client.request('thread/goal/set', {
                threadId, objective: goalCondition, status: 'active', tokenBudget: goalTokenBudget,
              }));
              const goal = parseCodexGoal(goalResponse?.goal, threadId);
              if (!goal) throw new Error('Invalid Codex goal response');
              if (goalStatus === null) {
                goalStatus = goal.status;
                publishCodexGoal(session, goal, wire.delivery);
                if (completed && goalStatus !== 'active') {
                  markCodexTurnCompleted(sessionId);
                  resolveDone();
                } else if (completed) {
                  awaitContinuation();
                }
              }
            } else {
              // Stop arrived before any goal RPC. Complete this as an interrupted chat turn.
              goalStatus = 'paused';
            }
          } finally {
            run.resolveActivation();
          }
        }
        phase = 'turn execution';
        await Promise.race([done, client.disconnected]);
        if (reuseId && !getCodexBinding(sessionId)?.pendingTurn) clearRollbackIntent(sessionId);
      } catch (error: unknown) {
        if (reuseId && !getCodexBinding(sessionId)?.pendingTurn
          && getRollbackIntent(sessionId)?.phase === 'ready' && assistant) {
          // A failed setup before turn/start must not leave an orphan assistant
          // that would be duplicated by an explicit retry of the edit.
          deleteMessage(assistant.id);
          wire.delivery.broadcastToSession(sessionId, { type: 'session.state', sessionId,
            messages: listMessagesWithParts(sessionId).slice(-50) });
        }
        // Do not expose upstream messages, stderr, request payloads, or credentials.
        const rpcCode = error instanceof CodexRequestError && error.code !== null ? ` (RPC ${error.code})` : '';
        const currentAssistant = assistant ? getMessageWithParts(assistant.id)?.message : null;
        if (currentAssistant?.role === 'assistant' && currentAssistant.status === 'streaming') {
          const updated = updateMessage(currentAssistant.id, { status: 'error', error: 'Codex turn failed', completedAt: Date.now() });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
        }
        wire.delivery.send(origin, { type: 'error', code: 'invalid_session',
          message: getCodexBinding(sessionId)?.pendingTurn
            ? `Codex failed during ${phase}${rpcCode}. The turn may have run; it will not be resent until reconciled.`
            : `Codex failed during ${phase}${rpcCode}. Check the host CLI setup.`, sessionId });
      } finally {
        clearTimeout(idleTimer);
        codexApprovals.cancelSession(sessionId);
        toolItems?.finish();
        starting.delete(sessionId);
        if (reuseId) resubmitting.delete(sessionId);
        if (run) {
          run.resolveActivation();
          active.delete(sessionId);
        }
        if (client) await client.close();
        if (hookChannel) await hookChannel.close();
      }
    },
    async fork(input) {
      if (active.has(input.sessionId) || starting.has(input.sessionId)) throw new Error('Codex session is busy');
      starting.add(input.sessionId);
      try {
        return await forkCodexSession(input, { connect: deps.connect, version: deps.version,
          root: id => workspaceRoot(getSession(id)!), busy: id => active.has(id), });
      } catch (error: unknown) {
        if (getDatabase().query('SELECT 1 FROM codex_fork_intents WHERE source_session_id = ?')
          .get(input.sessionId)) throw new Error('Codex fork outcome is uncertain; do not retry in this session', { cause: error });
        const safe = error instanceof Error && SAFE_FORK_ERRORS.has(error.message)
          ? error.message : 'Codex fork could not be started';
        throw new Error(safe, { cause: error });
      } finally {
        starting.delete(input.sessionId);
      }
    },
    async revert(input) {
      const result = await rollback(input.sessionId, 'revert', input.targetMessageId, null);
      if (!result) throw new Error('Codex revert result is unavailable');
      return result;
    },
    async editMessage(wire, origin, input) {
      try {
        const result = await rollback(input.sessionId, 'edit', input.messageId, input.content, wire);
        if (result || !getRollbackIntent(input.sessionId)) {
          wire.delivery.broadcastToSession(input.sessionId, { type: 'session.state', sessionId: input.sessionId,
            messages: listMessagesWithParts(input.sessionId).slice(-50) });
        }
        if (getRollbackIntent(input.sessionId)?.phase === 'ready') {
          resubmitting.set(input.sessionId, input.messageId);
          await execution.sendMessage(wire, origin, input.sessionId, input.content);
        }
      } catch (error: unknown) {
        // Never surface upstream RPC text, file paths, or database errors to the client.
        // Only report a known local validation reason; an intent means the RPC may have run.
        const reason = error instanceof Error && SAFE_EDIT_ERRORS.has(error.message)
          ? error.message : 'Codex rollback request or history read failed';
        const pending = getRollbackIntent(input.sessionId);
        wire.delivery.send(origin, { type: 'error', code: 'edit_error',
          message: pending?.phase === 'rollback'
            ? `Codex edit blocked: ${reason}. Rollback may have run; do not retry or send in this session.`
            : pending ? `Codex edit stopped after rollback: ${reason}. Do not retry or send in this session.`
              : `Codex edit stopped before rollback: ${reason}.`, sessionId: input.sessionId });
      }
    },
  };
  return execution;
}
