import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { getDatabase } from '@/store';
import {
  addMessageToQueue,
  getNextQueuedMessage,
} from '@/store/queued-messages';
import { createSessionRepository } from '@/infrastructure/sqlite/session-repository';
import { createMessageRepository } from '@/infrastructure/sqlite/message-repository';
import type { SessionMessageRepositoryHooks } from '@/application/ports/session-message';
import type { AssistantMessage, ToolPart } from '@jean2/sdk';

function makeHooks(): SessionMessageRepositoryHooks & { calls: string[] } {
  const calls: string[] = [];
  return {
    events: {
      publish(event) {
        calls.push(`${event.type}:${'messageId' in event ? event.messageId : event.sessionId}`);
      },
    },
    deleteAttachmentsForSession: () => calls.push('deleteAttachmentsForSession'),
    deleteAttachmentsForWorkspace: () => calls.push('deleteAttachmentsForWorkspace'),
    cleanupSessionOutputDir: () => calls.push('cleanupSessionOutputDir'),
    calls,
  };
}

function makeRepos() {
  const hooks = makeHooks();
  const sessions = createSessionRepository(() => getDatabase(), hooks);
  const messages = createMessageRepository(() => getDatabase(), hooks);
  return { sessions, messages, hooks };
}

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed' }) {
  return {
    id: overrides.id,
    workspaceId: overrides.workspaceId,
    preconfigId: null,
    title: overrides.title,
    status: overrides.status,
    metadata: null,
    parentId: null,
    agentName: null,
  };
}

function makeUserMessage(id: string, sessionId: string, createdAt: number) {
  return { id, sessionId, role: 'user' as const, createdAt };
}

function makeAssistantMessage(id: string, sessionId: string, createdAt: number, status = 'completed' as const) {
  return {
    id,
    sessionId,
    role: 'assistant' as const,
    createdAt,
    status,
    modelId: 'gpt-4o',
    providerId: 'openai',
    tokens: { prompt: 100, completion: 50 },
    cost: 0,
    completedAt: createdAt,
  } as AssistantMessage;
}

function makeTextPart(id: string, messageId: string, createdAt: number, text: string) {
  return {
    id,
    messageId,
    createdAt,
    type: 'text' as const,
    text,
  };
}

function makeToolPart(id: string, messageId: string, callId: string, status: 'pending' | 'completed' | 'running', createdAt: number, name = 'read-file') {
  return {
    id,
    messageId,
    createdAt,
    type: 'tool' as const,
    callId,
    name,
    state: status === 'completed'
      ? { status, input: {}, output: 'done', startedAt: createdAt, completedAt: createdAt + 1 }
      : { status, input: {}, ...(status === 'running' ? { startedAt: createdAt } : {}) },
  } as ToolPart;
}

describe('S5 session and message SQLite repositories', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDatabase();
    ({ sessionId, workspaceId } = seedWorkspaceWithSession());
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('preserves deterministic ordering for equal timestamps via sequence and rowid', () => {
    const { messages } = makeRepos();
    const ts = 1_000;
    messages.createMessage(makeUserMessage('m1', sessionId, ts));
    messages.createMessage(makeUserMessage('m2', sessionId, ts));
    messages.createMessage(makeUserMessage('m3', sessionId, ts));

    const listed = messages.listMessages(sessionId);
    expect(listed.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);

    // The per-session sequence allocation is monotonic in insertion order.
    const raw = getDatabase().query(
      'SELECT id, sequence FROM messages WHERE session_id = ? ORDER BY sequence ASC',
    ).all(sessionId) as { id: string; sequence: number }[];
    expect(raw.map((r) => [r.id, r.sequence])).toEqual([
      ['m1', 1],
      ['m2', 2],
      ['m3', 3],
    ]);
  });

  test('updateMessage preserves the indexed createdAt and sequence fields', () => {
    const { messages } = makeRepos();
    const created = messages.createMessage(makeAssistantMessage('a1', sessionId, 2_000));
    const updated = messages.updateMessage('a1', { status: 'error', error: 'boom' }) as AssistantMessage;

    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.status).toBe('error');
    expect(updated.error).toBe('boom');

    const raw = getDatabase().query(
      'SELECT sequence, created_at FROM messages WHERE id = ?',
    ).get('a1') as { sequence: number; created_at: number };
    expect(raw.sequence).toBe(1);
    expect(raw.created_at).toBe(2_000);
  });

  test('duplicate tool call ids prefer a pending part before completed parts', () => {
    const { messages } = makeRepos();
    messages.createMessage(makeAssistantMessage('a1', sessionId, 2_000));
    const pending = makeToolPart('p-pending', 'a1', 'call-dup', 'pending', 2_100);
    const completed = makeToolPart('p-completed', 'a1', 'call-dup', 'completed', 2_200);
    messages.createPart(pending, sessionId, { syncFts: false });
    messages.createPart(completed, sessionId, { syncFts: false });

    const resolved = messages.getToolPartByCallId(sessionId, 'call-dup');
    expect(resolved?.id).toBe('p-pending');

    // Once the pending part advances, no part is pending anymore, so the
    // newest row wins by (created_at DESC, rowid DESC): the completed part.
    messages.transitionToolToRunning('p-pending');
    const afterTransition = messages.getToolPartByCallId(sessionId, 'call-dup');
    expect(afterTransition?.id).toBe('p-completed');
    expect(afterTransition?.state.status).toBe('completed');
  });

  test('structured output round-trips through the message row mapping', () => {
    const { messages } = makeRepos();
    const structured = { data: { answer: 42, nested: { ok: true } } };
    messages.createMessage({
      ...makeAssistantMessage('a1', sessionId, 2_000),
      structuredOutput: structured,
    });

    const loaded = messages.getMessage('a1') as AssistantMessage;
    expect(loaded.structuredOutput).toEqual(structured);
  });

  test('compaction boundaries drive effective history and pagination', () => {
    const { messages } = makeRepos();
    messages.createMessage(makeUserMessage('u1', sessionId, 1_000));
    messages.createPart(makeTextPart('u1t', 'u1', 1_000, 'Hello'), sessionId, { syncFts: false });
    messages.createMessage(makeAssistantMessage('a1', sessionId, 2_000));
    messages.createPart(makeTextPart('a1t', 'a1', 2_000, 'Hi'), sessionId, { syncFts: false });

    // A compaction trigger with its summary outcome.
    messages.createMessage(makeUserMessage('trigger', sessionId, 3_000));
    messages.createPart({
      id: 'trigger-c',
      messageId: 'trigger',
      createdAt: 3_000,
      type: 'compaction' as const,
      auto: true,
      overflow: false,
    }, sessionId, { syncFts: false });
    messages.createMessage({
      ...makeAssistantMessage('summary', sessionId, 4_000),
      summary: true,
      mode: 'compaction' as const,
      parentId: 'trigger',
    });
    messages.createPart(makeTextPart('summary-t', 'summary', 4_000, 'Summary text'), sessionId, { syncFts: false });
    messages.createMessage(makeUserMessage('u2', sessionId, 5_000));
    messages.createPart(makeTextPart('u2t', 'u2', 5_000, 'More'), sessionId, { syncFts: false });

    const boundary = messages.getLatestCompactionBoundary(sessionId);
    expect(boundary?.triggerId).toBe('trigger');
    expect(boundary?.summaryId).toBe('summary');

    const effective = messages.buildEffectiveContextHistory(sessionId);
    expect(effective.hasCompaction).toBe(true);
    expect(effective.latestCompactionBoundary).toBe('trigger');
    // Pre-boundary history is excluded from model context.
    expect(effective.messages.map((m) => m.message.id)).toEqual(['trigger', 'summary', 'u2']);

    const page = messages.listLatestMessagesWithPartsPage(sessionId, 2);
    expect(page.messages.map((m) => m.message.id)).toEqual(['summary', 'u2']);
    expect(page.pagination.hasOlder).toBe(true);

    const before = messages.listMessagesWithPartsBeforeSequence(sessionId, 3, 2);
    expect(before.messages.map((m) => m.message.id)).toEqual(['u1', 'a1']);
  });

  test('deleteSession cascades messages and parts and runs the side-effect hooks in order', () => {
    const { sessions, messages, hooks } = makeRepos();
    messages.createMessage(makeUserMessage('m1', sessionId, 1_000));
    messages.createPart(makeTextPart('p1', 'm1', 1_000, 'text'), sessionId, { syncFts: false });

    expect(sessions.deleteSession(sessionId)).toBe(true);
    expect(messages.listMessages(sessionId)).toEqual([]);
    expect(messages.getPartsBySession(sessionId)).toEqual([]);
    expect(hooks.calls).toEqual([
      'deleteAttachmentsForSession',
      `session.deleted:${sessionId}`,
      'cleanupSessionOutputDir',
    ]);
  });

  test('deleteSessionsByWorkspace removes sessions and runs workspace hooks before per-session cleanup', () => {
    const { sessions, hooks } = makeRepos();
    sessions.createSession(makeSession({
      id: 'extra',
      workspaceId,
      title: 'Extra',
      status: 'active',
    }));

    sessions.deleteSessionsByWorkspace(workspaceId);

    expect(sessions.listSessionsByWorkspace(workspaceId)).toEqual([]);
    expect(hooks.calls).toContain('deleteAttachmentsForWorkspace');
    expect(hooks.calls.filter((c) => c.startsWith('session.deleted:')).length).toBeGreaterThanOrEqual(1);
    const workspaceIndex = hooks.calls.indexOf('deleteAttachmentsForWorkspace');
    expect(hooks.calls.findIndex((c) => c.startsWith('session.deleted:'))).toBeGreaterThan(workspaceIndex);
  });

  test('streaming snapshots guard identity and persist batches transactionally', () => {
    const { messages } = makeRepos();
    messages.createMessage(makeAssistantMessage('a1', sessionId, 2_000));
    messages.createPart({
      id: 'snap',
      messageId: 'a1',
      createdAt: 2_100,
      type: 'text' as const,
      text: 'initial',
    }, sessionId, { syncFts: false });

    // Identity guard: mismatched messageId affects zero rows.
    expect(messages.persistStreamingPartSnapshot({
      id: 'snap',
      messageId: 'wrong',
      sessionId,
      type: 'text',
      createdAt: 2_100,
      text: 'x',
    })).toBe(false);

    // Batch persists in one transaction and reports the exact count.
    const count = messages.persistStreamingPartSnapshots([
      { id: 'snap', messageId: 'a1', sessionId, type: 'text', createdAt: 2_100, text: 'updated' },
      { id: 'missing', messageId: 'a1', sessionId, type: 'text', createdAt: 2_100, text: 'y' },
    ]);
    expect(count).toBe(1);

    const loaded = messages.getPart('snap') as { text: string };
    expect(loaded.text).toBe('updated');
  });

  test('orphaned tool calls reconcile to interrupted through the repository', () => {
    const { messages } = makeRepos();
    messages.createMessage(makeAssistantMessage('a1', sessionId, 2_000));
    messages.createPart(makeToolPart('t1', 'a1', 'call-1', 'pending', 2_100), sessionId, { syncFts: false });
    messages.createPart(makeToolPart('t2', 'a1', 'call-2', 'running', 2_200), sessionId, { syncFts: false });

    expect(messages.findOrphanedToolCalls(sessionId).map((p) => p.id)).toEqual(['t1', 't2']);
    expect(messages.reconcileOrphanedToolCalls(sessionId)).toBe(2);
    expect(messages.getPart('t1')?.type === 'tool'
      ? (messages.getPart('t1') as ToolPart).state.status
      : 'n/a').toBe('interrupted');
    expect(messages.reconcileAllOrphanedToolCalls()).toBe(0);
  });

  test('queue FIFO separation is preserved by the unchanged queue module', () => {
    const first = addMessageToQueue(sessionId, 'first');
    const second = addMessageToQueue(sessionId, 'second');

    expect(getNextQueuedMessage(sessionId)?.id).toBe(first.id);
    expect(getNextQueuedMessage(sessionId)?.id).toBe(first.id);
    const { deleteQueuedMessage } = require('@/store/queued-messages') as typeof import('@/store/queued-messages');
    deleteQueuedMessage(first.id);
    expect(getNextQueuedMessage(sessionId)?.id).toBe(second.id);
  });
});
