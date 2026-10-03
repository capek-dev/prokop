import { forkSession, getSessionMessages, type SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { MessageWithParts } from '@prokopai/sdk';
import type { RevertExecutionResult } from '@/application/ports/execution';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { deleteMessage, listMessagesWithParts, updatePart } from '@/infrastructure/sqlite/message-store';

export interface ClaudeRollbackDependencies {
  readHistory?: typeof getSessionMessages;
  forkHistory?: typeof forkSession;
}

const UNAVAILABLE = 'Claude conversation history is not available for Edit or Undo';

/** One native turn: a user message plus every consecutive assistant message it triggered. */
export interface NativeTurn {
  userId: string;
  /** UUID of the turn's final native message (the inclusive fork cutoff); null for a trailing user-only turn. */
  assistantId: string | null;
  /** Native message count consumed by this turn. */
  length: number;
  userText: string;
  /** Text joined across the turn's assistant messages; thinking contributes nothing. */
  assistantText: string;
}

export function nativeText(raw: SessionMessage): string | null {
  const message = raw.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || !content.length || content.some(block =>
    !block || typeof block !== 'object' || !('type' in block)
    || block.type === 'text' && typeof block.text !== 'string'
    || block.type !== 'text' && block.type !== 'thinking' && block.type !== 'redacted_thinking')) return null;
  return content.filter(block => block.type === 'text').map(block => block.text as string).join('');
}

/** User prompts must be plain text: no thinking, tool results, or other blocks in a rollback target. */
function plainUserText(raw: SessionMessage): string | null {
  const message = raw.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return null;
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || !content.length || content.some(block =>
    !block || typeof block !== 'object' || !('type' in block) || block.type !== 'text'
    || typeof block.text !== 'string')) return null;
  return content.map(block => block.text).join('');
}

function entryInvalid(entry: SessionMessage, nativeId: string, seen: Set<string>): boolean {
  return entry.session_id !== nativeId || entry.parent_tool_use_id !== null
    || entry.parent_agent_id !== null || typeof entry.uuid !== 'string' || !entry.uuid
    || seen.has(entry.uuid);
}

/** Groups native history into user→assistant turns. Refuses anything but main-thread plain text/thinking messages. */
export function groupClaudeTurns(native: SessionMessage[], nativeId: string,
  options?: { allowTrailingUser?: boolean; limit?: number }): NativeTurn[] {
  const turns: NativeTurn[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (index < native.length && turns.length < (options?.limit ?? Infinity)) {
    const user = native[index]!;
    const userText = user.type === 'user' && !entryInvalid(user, nativeId, seen) ? plainUserText(user) : null;
    if (userText === null) throw new Error(UNAVAILABLE);
    seen.add(user.uuid);
    index++;
    const start = index;
    let assistantText = '';
    while (index < native.length && native[index]!.type === 'assistant') {
      const entry = native[index]!;
      const text = entryInvalid(entry, nativeId, seen) ? null : nativeText(entry);
      if (text === null) throw new Error(UNAVAILABLE);
      seen.add(entry.uuid);
      assistantText += text;
      index++;
    }
    if (index === start) {
      // A fork cutoff may keep a final user message without its reply; only ever the last turn.
      if (options?.allowTrailingUser && index === native.length) {
        turns.push({ userId: user.uuid, assistantId: null, length: 1, userText, assistantText: '' });
        break;
      }
      // A user message with no assistant reply, or a non-assistant entry mid-turn, is unverifiable.
      throw new Error(UNAVAILABLE);
    }
    turns.push({ userId: user.uuid, assistantId: native[index - 1]!.uuid, length: index - start + 1,
      userText, assistantText });
  }
  return turns;
}

/** Conservative mapping: never infer a cutoff from text, ordering alone, or tool-result messages. */
export function matchClaudeHistory(local: MessageWithParts[], native: SessionMessage[], nativeId: string): NativeTurn[] {
  if (!local.length || local.length % 2 !== 0) throw new Error(UNAVAILABLE);
  const turns = groupClaudeTurns(native, nativeId);
  if (turns.length !== local.length / 2) throw new Error(UNAVAILABLE);
  verifyLocalTurns(local, turns);
  return turns;
}

/**
 * Edit and Undo keep only the first `turnCount` turns, so only those must
 * match. Later turns (an interrupted reply, tool output) are discarded with
 * the rollback and may be unverifiable without blocking it.
 */
export function matchClaudeHistoryPrefix(local: MessageWithParts[], native: SessionMessage[], nativeId: string,
  turnCount: number): NativeTurn[] {
  if (turnCount * 2 > local.length) throw new Error(UNAVAILABLE);
  if (turnCount === 0) return [];
  const turns = groupClaudeTurns(native, nativeId, { limit: turnCount });
  if (turns.length !== turnCount) throw new Error(UNAVAILABLE);
  verifyLocalTurns(local.slice(0, turnCount * 2), turns);
  return turns;
}

function verifyLocalTurns(local: MessageWithParts[], turns: NativeTurn[]): void {
  const inherited = getDatabase().query<{ native_user_id: string }, [string]>(
    'SELECT native_user_id FROM claude_inherited_user_ids WHERE message_id = ?',
  );
  for (let turn = 0; turn < turns.length; turn++) {
    const user = local[turn * 2]!;
    const assistant = local[turn * 2 + 1]!;
    const nativeTurn = turns[turn]!;
    const userText = user.parts.filter(part => part.type === 'text');
    const assistantText = assistant.parts.filter(part => part.type === 'text');
    if (user.message.role !== 'user' || assistant.message.role !== 'assistant'
      || assistant.message.status !== 'completed' || user.parts.length !== 1 || userText.length !== 1
      || assistant.parts.some(part => part.type !== 'text') || assistant.parts.length !== 1
      || nativeTurn.userId !== (inherited.get(user.message.id)?.native_user_id ?? user.message.id)
      || nativeTurn.userText !== userText[0]!.text || nativeTurn.assistantText !== assistantText[0]!.text) {
      throw new Error(UNAVAILABLE);
    }
  }
}

export function rollbackResult(local: MessageWithParts[], firstRemoved: number, edit: boolean): RevertExecutionResult {
  const removed = local.slice(edit ? firstRemoved + 1 : firstRemoved);
  return { revertedTo: { messageId: edit ? local[firstRemoved]!.message.id
    : firstRemoved ? local[firstRemoved - 1]!.message.id : null,
  messageCount: local.length - removed.length },
  removed: { messageIds: removed.map(entry => entry.message.id),
    partCount: removed.reduce((sum, entry) => sum + entry.parts.length, 0) } };
}

export function applyClaudeRollback(input: {
  sessionId: string; operation: 'edit' | 'revert'; targetId: string; content: string | null;
  originalNativeId: string; newNativeId: string | null; firstRemoved: number;
  inheritedUsers: Array<{ messageId: string; nativeId: string }>;
}): RevertExecutionResult {
  return getDatabase().transaction(() => {
    const db = getDatabase();
    const intent = db.query<{ phase: string; target_message_id: string }, [string]>(
      'SELECT phase, target_message_id FROM claude_rollback_intents WHERE session_id = ?',
    ).get(input.sessionId);
    const binding = db.query<{ native_session_id: string; pending: number }, [string]>(
      'SELECT native_session_id, pending FROM claude_session_bindings WHERE session_id = ?',
    ).get(input.sessionId);
    if (intent?.phase !== 'fork' || intent.target_message_id !== input.targetId
      || binding?.native_session_id !== input.originalNativeId || binding.pending !== 0) {
      throw new Error('Claude rollback state changed');
    }
    const local = listMessagesWithParts(input.sessionId);
    const target = local[input.firstRemoved];
    if (!target || target.message.role !== 'user'
      || input.operation === 'edit' && (input.content === null || target.message.id !== input.targetId)) {
      throw new Error('Claude rollback target changed');
    }
    const result = rollbackResult(local, input.firstRemoved, input.operation === 'edit');
    if (input.inheritedUsers.length !== input.firstRemoved / 2
      || input.inheritedUsers.some((item, index) =>
        local[index * 2]?.message.id !== item.messageId || !item.nativeId)) {
      throw new Error('Claude inherited history changed');
    }
    if (input.operation === 'edit') {
      const part = target.parts[0];
      if (part?.type !== 'text' || !updatePart(part.id, { text: input.content })) {
        throw new Error('Claude edit text is unavailable');
      }
    }
    for (const id of result.removed.messageIds) {
      if (!deleteMessage(id)) throw new Error('Claude rollback deletion failed');
    }
    if (input.newNativeId) {
      const updated = db.run('UPDATE claude_session_bindings SET native_session_id = ? WHERE session_id = ? AND native_session_id = ? AND pending = 0',
        [input.newNativeId, input.sessionId, input.originalNativeId]);
      if (updated.changes !== 1) throw new Error('Claude rollback binding changed');
    } else {
      db.run('DELETE FROM claude_session_bindings WHERE session_id = ? AND native_session_id = ? AND pending = 0',
        [input.sessionId, input.originalNativeId]);
    }
    for (const item of input.inheritedUsers) {
      db.run(`INSERT INTO claude_inherited_user_ids (message_id, native_user_id) VALUES (?, ?)
        ON CONFLICT(message_id) DO UPDATE SET native_user_id = excluded.native_user_id`,
      [item.messageId, item.nativeId]);
    }
    if (input.operation === 'edit') {
      db.run('DELETE FROM claude_inherited_user_ids WHERE message_id = ?', [target.message.id]);
      db.run("UPDATE claude_rollback_intents SET phase = 'ready' WHERE session_id = ?", [input.sessionId]);
    } else {
      db.run('DELETE FROM claude_rollback_intents WHERE session_id = ?', [input.sessionId]);
    }
    return result;
  })();
}
