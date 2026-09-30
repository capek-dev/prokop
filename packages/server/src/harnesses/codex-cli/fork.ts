import type { ForkExecutionResult, SessionExecutionPort } from '@/application/ports/execution';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createMessage, createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { CodexAppServer, codexObject, type CodexConnection } from './app-server';
import { bindCodexThread, getCodexBinding } from './bindings';
import { getCodexModelSelection, saveCodexModelSelection } from './models';
import { getRollbackIntent, readRollbackHistory, sameTurns } from './rollback';

export function upstreamUserId(messageId: string): string {
  const row = getDatabase().query<{ upstream_client_id: string }, [string]>(
    'SELECT upstream_client_id FROM codex_inherited_user_ids WHERE message_id = ?',
  ).get(messageId);
  return row?.upstream_client_id ?? messageId;
}

export async function forkCodexSession(
  input: Parameters<SessionExecutionPort['fork']>[0],
  deps: { connect(): CodexConnection; version(): string; root(sessionId: string): string; busy(sessionId: string): boolean },
): Promise<ForkExecutionResult> {
  const session = getSession(input.sessionId);
  if (!session || session.harness !== 'codex-cli' || session.status === 'closed' || deps.busy(session.id)) {
    throw new Error('Codex session is unavailable or busy');
  }
  const root = deps.root(session.id);
  const version = deps.version();
  const binding = getCodexBinding(session.id);
  if (!binding || binding.workspaceRoot !== root || binding.cliVersion !== version) {
    throw new Error('Codex thread binding is unavailable or changed');
  }
  const metadata = codexObject(session.metadata);
  if (binding.pendingTurn || binding.goalRequested || metadata?.codexGoal || metadata?.codexGoalPending
    || getRollbackIntent(session.id)) throw new Error('Codex history requires recovery before fork');
  if (getDatabase().query('SELECT 1 FROM codex_fork_intents WHERE source_session_id = ?').get(session.id)) {
    throw new Error('A Codex fork has an uncertain outcome; do not retry it');
  }
  const client = new CodexAppServer(deps.connect(), () => {});
  try {
    await client.initialize();
    const resumed = codexObject(await client.request('thread/resume', {
      threadId: binding.threadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const resumedThread = codexObject(resumed?.thread);
    if (resumedThread?.id !== binding.threadId || codexObject(resumedThread.status)?.type !== 'idle') {
      throw new Error('Codex thread is not idle after resume');
    }
    const goalResponse = codexObject(await client.request('thread/goal/get', { threadId: binding.threadId }));
    if (!goalResponse || !Object.hasOwn(goalResponse, 'goal') || goalResponse.goal !== null) {
      throw new Error('Codex goal history cannot be forked');
    }
    const turnIds = await readRollbackHistory(client, binding);
    const local = listMessagesWithParts(session.id);
    const targetIndex = local.findIndex(entry => entry.message.id === input.targetMessageId);
    if (targetIndex < 1 || targetIndex % 2 !== 1 || local[targetIndex]?.message.role !== 'assistant'
      || local[targetIndex].message.status !== 'completed') {
      throw new Error('Codex fork requires a completed assistant response');
    }
    const retained = local.slice(0, targetIndex + 1);
    // A copied image URL belongs to the source session. Do not create a fork
    // that breaks when its source attachments are removed.
    if (retained.some(entry => entry.parts.some(part => part.type === 'image'))) {
      throw new Error('Codex fork of image history is not supported');
    }
    const cutoff = turnIds[(targetIndex - 1) / 2]!;
    getDatabase().run(`INSERT INTO codex_fork_intents
      (source_session_id, target_message_id, before_turn_id, created_at) VALUES (?, ?, ?, ?)`,
    [session.id, input.targetMessageId, cutoff, new Date().toISOString()]);
    // An uncertain RPC cannot be issued a second time. The intent remains on
    // disconnect, malformed response, or failure to persist the local fork.
    const forked = codexObject(await client.request('thread/fork', {
      threadId: binding.threadId, lastTurnId: cutoff, cwd: root,
      approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const thread = codexObject(forked?.thread);
    const newThreadId = thread?.id;
    if (typeof newThreadId !== 'string' || !newThreadId || newThreadId === binding.threadId
      || getDatabase().query('SELECT 1 FROM codex_session_bindings WHERE thread_id = ?').get(newThreadId)) {
      throw new Error('Codex fork returned an invalid thread');
    }
    const forkResume = codexObject(await client.request('thread/resume', {
      threadId: newThreadId, cwd: root, approvalPolicy: 'on-request', sandbox: 'workspace-write',
    }));
    const forkResumeThread = codexObject(forkResume?.thread);
    if (forkResumeThread?.id !== newThreadId || codexObject(forkResumeThread.status)?.type !== 'idle') {
      throw new Error('Codex forked thread is not idle');
    }
    const read = codexObject(await client.request('thread/read', { threadId: newThreadId, includeTurns: true }));
    const history = codexObject(read?.thread);
    const turns = history?.turns;
    if (history?.id !== newThreadId || codexObject(history.status)?.type !== 'idle'
      || !Array.isArray(turns) || turns.length !== retained.length / 2) {
      throw new Error('Codex fork history does not match the selected response');
    }
    const actual = turns.map((raw: unknown, index: number) => {
      const turn = codexObject(raw);
      const items = turn?.items;
      const user = retained[index * 2]!.message;
      if (typeof turn?.id !== 'string' || turn.itemsView !== 'full'
        || !['completed', 'failed', 'interrupted'].includes(String(turn.status)) || !Array.isArray(items)
        || items.filter((item: unknown) => codexObject(item)?.type === 'userMessage').length !== 1
        || !items.some((item: unknown) => codexObject(item)?.clientId === upstreamUserId(user.id)
          && codexObject(item)?.type === 'userMessage')) {
        throw new Error('Codex fork history does not match the selected response');
      }
      return turn.id;
    });
    if (!sameTurns(actual, turnIds.slice(0, (targetIndex + 1) / 2))) {
      throw new Error('Codex fork history does not match the selected response');
    }
    return getDatabase().transaction(() => {
      const { codexGoal: _goal, codexGoalPending: _pending, ...sourceMetadata } = metadata ?? {};
      const forkedSession = createSession({
        id: crypto.randomUUID(), workspaceId: session.workspaceId, workspaceRootId: session.workspaceRootId,
        harness: 'codex-cli', preconfigId: session.preconfigId,
        title: input.title || `${session.title || 'Untitled'} (fork)`, status: 'active',
        metadata: { ...sourceMetadata, forkedFrom: session.id }, parentId: null, agentName: null,
        agentId: session.agentId, selectedModel: session.selectedModel,
        selectedProvider: session.selectedProvider, permissionMode: session.permissionMode,
      });
      bindCodexThread({ sessionId: forkedSession.id, threadId: newThreadId, cliVersion: version, workspaceRoot: root });
      const selection = getCodexModelSelection(session.id);
      if (selection) saveCodexModelSelection(forkedSession.id, selection);
      const ids = new Map(retained.map(entry => [entry.message.id, crypto.randomUUID()]));
      for (const entry of retained) {
        const message = entry.message;
        const id = ids.get(message.id)!;
        createMessage({ ...message, id, sessionId: forkedSession.id,
          ...(message.role === 'assistant' && message.parentId
            ? { parentId: ids.get(message.parentId) } : {}) });
        if (message.role === 'user') {
          getDatabase().run(`INSERT INTO codex_inherited_user_ids (message_id, upstream_client_id)
            VALUES (?, ?)`, [id, upstreamUserId(message.id)]);
        }
        for (const part of entry.parts) createPart({ ...part, id: crypto.randomUUID(), messageId: id }, forkedSession.id);
      }
      getDatabase().run('DELETE FROM codex_fork_intents WHERE source_session_id = ?', [session.id]);
      return { forkedSession, messages: listMessagesWithParts(forkedSession.id) };
    })();
  } finally {
    await client.close();
  }
}
