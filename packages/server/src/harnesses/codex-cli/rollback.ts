import type { MessageWithParts } from '@prokopai/sdk';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { deleteMessage, listMessagesWithParts, updatePart } from '@/infrastructure/sqlite/message-store';
import type { RevertExecutionResult } from '@/application/ports/execution';
import { CodexAppServer, codexObject } from './app-server';
import type { CodexBinding } from './bindings';

export interface RollbackIntent {
  sessionId: string;
  operation: 'edit' | 'revert';
  targetMessageId: string;
  content: string | null;
  beforeTurnId: string;
  turnIds: string[];
  phase: 'rollback' | 'ready' | 'sent';
}

export function getRollbackIntent(sessionId: string): RollbackIntent | null {
  const row = getDatabase().query<{
    session_id: string; operation: 'edit' | 'revert'; target_message_id: string;
    content: string | null; before_turn_id: string; turn_ids: string; phase: RollbackIntent['phase'];
  }, [string]>('SELECT * FROM codex_rollback_intents WHERE session_id = ?').get(sessionId);
  if (!row) return null;
  const turns: unknown = JSON.parse(row.turn_ids);
  if (!Array.isArray(turns) || turns.some(id => typeof id !== 'string')) throw new Error('Invalid Codex rollback intent');
  return { sessionId: row.session_id, operation: row.operation, targetMessageId: row.target_message_id,
    content: row.content, beforeTurnId: row.before_turn_id, turnIds: turns, phase: row.phase };
}

export function saveRollbackIntent(intent: RollbackIntent): void {
  getDatabase().run(`INSERT INTO codex_rollback_intents
    (session_id, operation, target_message_id, content, before_turn_id, turn_ids, phase)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [intent.sessionId, intent.operation, intent.targetMessageId,
    intent.content, intent.beforeTurnId, JSON.stringify(intent.turnIds), intent.phase]);
}

export function setRollbackPhase(sessionId: string, phase: RollbackIntent['phase']): void {
  getDatabase().run('UPDATE codex_rollback_intents SET phase = ? WHERE session_id = ?', [phase, sessionId]);
}

export function clearRollbackIntent(sessionId: string): void {
  getDatabase().run('DELETE FROM codex_rollback_intents WHERE session_id = ?', [sessionId]);
}

/** A missing, truncated, or extra Codex turn must never be treated as an editable transcript. */
export async function readRollbackHistory(client: CodexAppServer, binding: CodexBinding): Promise<string[]> {
  const response = codexObject(await client.request('thread/read', { threadId: binding.threadId, includeTurns: true }));
  const thread = codexObject(response?.thread);
  if (thread?.id !== binding.threadId || codexObject(thread.status)?.type !== 'idle'
    || !Array.isArray(thread.turns)) throw new Error('Codex thread history is unavailable');
  const local = listMessagesWithParts(binding.sessionId);
  const users = local.filter(entry => entry.message.role === 'user');
  const assistants = local.filter(entry => entry.message.role === 'assistant');
  const inherited = getDatabase().query<{ upstream_client_id: string }, [string]>(
    'SELECT upstream_client_id FROM codex_inherited_user_ids WHERE message_id = ?',
  );
  if (users.length !== assistants.length || users.length !== thread.turns.length
    || local.length !== users.length + assistants.length) throw new Error('Codex transcript does not match turn history');
  const ids = thread.turns.map((raw: unknown, index: number) => {
    const turn = codexObject(raw);
    if (!turn || typeof turn.id !== 'string' || !turn.id || turn.itemsView !== 'full'
      || !['completed', 'failed', 'interrupted'].includes(String(turn.status)) || !Array.isArray(turn.items)
      || turn.items.filter((rawItem: unknown) => codexObject(rawItem)?.type === 'userMessage').length !== 1
      || !turn.items.some((rawItem: unknown) => {
        const item = codexObject(rawItem);
        return item?.type === 'userMessage' && item.clientId ===
          (inherited.get(users[index]!.message.id)?.upstream_client_id ?? users[index]!.message.id);
      }) || local[index * 2]?.message.id !== users[index]?.message.id
      || local[index * 2 + 1]?.message.id !== assistants[index]?.message.id
      || (assistants[index]?.message.role === 'assistant'
        && assistants[index].message.status === 'streaming')) throw new Error('Codex turn identity is incomplete');
    return turn.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Codex turn identity is ambiguous');
  return ids;
}

/** Recovery checks only the upstream IDs, not a locally inferred successful RPC response. */
export async function readTurnIds(client: CodexAppServer, threadId: string): Promise<string[]> {
  const response = codexObject(await client.request('thread/read', { threadId, includeTurns: true }));
  const thread = codexObject(response?.thread);
  if (thread?.id !== threadId || codexObject(thread.status)?.type !== 'idle' || !Array.isArray(thread.turns)) {
    throw new Error('Codex rollback history is unavailable');
  }
  const ids = thread.turns.map((raw: unknown) => {
    const turn = codexObject(raw);
    if (!turn || typeof turn.id !== 'string' || !turn.id || turn.itemsView !== 'full'
      || !['completed', 'failed', 'interrupted'].includes(String(turn.status))) {
      throw new Error('Codex rollback history is incomplete');
    }
    return turn.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Codex rollback history is ambiguous');
  return ids;
}

export function rollbackResult(local: MessageWithParts[], targetIndex: number, edit: boolean): RevertExecutionResult {
  const removed = local.slice(edit ? targetIndex + 1 : targetIndex === 0 ? 0 : targetIndex);
  return { revertedTo: { messageId: edit ? local[targetIndex]!.message.id
    : targetIndex === 0 ? null : local[targetIndex - 1]!.message.id,
  messageCount: local.length - removed.length },
  removed: { messageIds: removed.map(entry => entry.message.id),
    partCount: removed.reduce((count, entry) => count + entry.parts.length, 0) } };
}

export function applyRollback(intent: RollbackIntent): RevertExecutionResult {
  return getDatabase().transaction(() => {
    const current = getRollbackIntent(intent.sessionId);
    if (!current || current.phase !== 'rollback') throw new Error('Codex rollback is not pending');
    const local = listMessagesWithParts(intent.sessionId);
    const targetIndex = local.findIndex(entry => entry.message.id === intent.targetMessageId);
    const index = intent.operation === 'revert' && targetIndex > 0 ? targetIndex + 1 : targetIndex;
    if (index < 0 || local[index]?.message.role !== 'user') throw new Error('Codex rollback target disappeared');
    const result = rollbackResult(local, index, intent.operation === 'edit');
    if (intent.operation === 'edit') {
      const text = local[index]!.parts.find(part => part.type === 'text');
      if (!text || intent.content === null || !updatePart(text.id, { text: intent.content })) {
        throw new Error('Codex edit text is unavailable');
      }
      // Resubmission creates a new Codex user item with this local ID.
      getDatabase().run('DELETE FROM codex_inherited_user_ids WHERE message_id = ?', [local[index]!.message.id]);
    }
    for (const messageId of result.removed.messageIds) {
      if (!deleteMessage(messageId)) throw new Error('Codex transcript deletion failed');
    }
    if (intent.operation === 'edit') setRollbackPhase(intent.sessionId, 'ready');
    else clearRollbackIntent(intent.sessionId);
    return result;
  })();
}

export function sameTurns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}
