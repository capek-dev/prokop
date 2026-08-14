import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, Session, ToolPart } from '@jean2/sdk';
import {
  createInMemoryConversationStore,
  createInMemoryMessageQueueStore,
  createSqliteConversationStore,
  type ClosableStore,
  type ConversationStore,
} from '@capekai/core/storage';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function session(id: string, parentId: string | null = null, createdAt = '2026-01-01T00:00:00.000Z'): Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string } {
  return {
    id,
    workspaceId: 'workspace-1',
    preconfigId: null,
    title: id,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    metadata: null,
    parentId,
    agentName: parentId ? 'research' : null,
  };
}

function message(id: string, role: Message['role'], createdAt: number, extra: Partial<Message> = {}): Message {
  if (role === 'assistant') {
    return {
      id,
      sessionId: 'root',
      role,
      status: 'completed',
      modelId: 'model',
      providerId: 'provider',
      tokens: { prompt: 0, completion: 0 },
      cost: 0,
      createdAt,
      ...extra,
    } as Message;
  }
  return { id, sessionId: 'root', role, createdAt, ...extra } as Message;
}

function runConversationContract(name: string, createStore: () => ConversationStore & Partial<ClosableStore>): void {
  describe(name, () => {
    test('preserves deterministic ordering, snapshots, tool state, compaction, deletion, and child resume', () => {
      const store = createStore();
      store.createSession(session('root'));
      store.createSession(session('child-b', 'root', '2026-01-01T00:00:01.000Z'));
      store.createSession(session('child-a', 'root', '2026-01-01T00:00:01.000Z'));
      store.createSession(session('orphan', 'missing-parent', '2026-01-01T00:00:01.000Z'));
      store.updateSession('root', {
        runningAt: '2026-01-01T00:00:03.000Z',
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
        title: 'Updated',
        metadata: { goal: { status: 'active' } },
      });
      expect(store.getSession('root')).toMatchObject({
        runningAt: '2026-01-01T00:00:03.000Z',
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
        title: 'Updated',
        metadata: { goal: { status: 'active' } },
      });
      expect(store.getChildSessions('root').map(child => child.id)).toEqual(['child-b', 'child-a']);
      expect(store.getSession('orphan')?.parentId).toBe('missing-parent');

      store.createMessage(message('old', 'user', 100));
      store.createPart({ id: 'part-z', messageId: 'old', type: 'text', text: 'old-z', createdAt: 5 }, 'root');
      store.createPart({ id: 'part-a', messageId: 'old', type: 'text', text: 'old-a', createdAt: 5 }, 'root');
      store.createMessage(message('trigger', 'user', 50));
      store.createPart({ id: 'trigger-part', messageId: 'trigger', type: 'compaction', auto: false, createdAt: 6 }, 'root');
      store.createMessage(message('summary', 'assistant', 40, {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger',
      }));
      store.createPart({ id: 'summary-text', messageId: 'summary', type: 'text', text: 'summary', createdAt: 7 }, 'root');
      store.createMessage(message('after', 'user', 30));
      store.createPart({ id: 'stream', messageId: 'after', type: 'text', text: '', createdAt: 8 }, 'root');
      const tool: ToolPart = {
        id: 'tool',
        messageId: 'after',
        type: 'tool',
        callId: 'call-1',
        name: 'task',
        state: { status: 'pending', input: { task: true } },
        createdAt: 9,
      };
      store.createPart(tool, 'root');
      store.createPart({
        ...tool,
        id: 'duplicate-z',
        callId: 'duplicate-call',
        createdAt: 10,
      }, 'root');
      store.createPart({
        ...tool,
        id: 'duplicate-a',
        callId: 'duplicate-call',
        createdAt: 10,
      }, 'root');

      expect(store.listMessagesWithParts('root').map(entry => entry.message.id)).toEqual([
        'old', 'trigger', 'summary', 'after',
      ]);
      expect(store.getPartsByMessage('old').map(part => part.id)).toEqual(['part-z', 'part-a']);
      store.updatePart('part-z', { createdAt: 11 });
      expect(store.getPartsByMessage('old').map(part => part.id)).toEqual(['part-a', 'part-z']);
      expect(store.getPartsBySession('root').at(-1)?.id).toBe('part-z');
      expect(() => store.createPart({
        id: 'wrong-session-part',
        messageId: 'old',
        type: 'text',
        text: 'wrong',
        createdAt: 5,
      }, 'child-a')).toThrow('Message does not exist in session: old');
      expect(() => store.createPart({
        id: 'missing-message-part',
        messageId: 'missing',
        type: 'text',
        text: 'missing',
        createdAt: 5,
      }, 'root')).toThrow('Message does not exist in session: missing');
      expect(store.persistStreamingPartSnapshots([
        { id: 'stream', messageId: 'after', sessionId: 'root', type: 'text', text: 'saved', createdAt: 8 },
        { id: 'stream', messageId: 'wrong', sessionId: 'root', type: 'text', text: 'wrong', createdAt: 8 },
      ])).toBe(1);
      expect(store.getPart('stream')).toMatchObject({ text: 'saved' });

      const latestDuplicate = store.transitionToolToRunningByCallId('root', 'duplicate-call');
      expect(latestDuplicate?.id).toBe('duplicate-a');
      expect((store.getPart('duplicate-z') as ToolPart).state.status).toBe('pending');
      expect((store.getPart('duplicate-a') as ToolPart).state.status).toBe('running');

      const running = store.transitionToolToRunningByCallId('root', 'call-1', 'child-a');
      expect(running?.state).toMatchObject({ status: 'running', childSessionId: 'child-a' });
      const latest = store.getPart('tool') as ToolPart;
      store.updatePart('tool', {
        state: {
          status: 'completed',
          input: latest.state.input,
          output: 'done',
          startedAt: 'startedAt' in latest.state ? latest.state.startedAt : 0,
          completedAt: Date.now(),
          childSessionId: 'childSessionId' in latest.state ? latest.state.childSessionId : undefined,
        },
      });
      expect((store.getPart('tool') as ToolPart).state).toMatchObject({
        status: 'completed',
        childSessionId: 'child-a',
      });
      const interrupted = store.transitionToolToInterrupted('tool', 'cascade');
      expect(interrupted?.state).toMatchObject({
        status: 'interrupted',
        reason: 'cascade',
        childSessionId: 'child-a',
      });

      const history = store.buildEffectiveContextHistory('root');
      expect(history.latestCompactionBoundary).toBe('trigger');
      expect(history.messages.map(entry => entry.message.id)).toEqual(['trigger', 'summary', 'after']);
      expect(store.deleteMessage('after')).toBe(true);
      expect(store.getPart('stream')).toBeNull();
      expect(store.listLatestMessagesWithPartsPage('root', 2).messages.map(entry => entry.message.id))
        .toEqual(['trigger', 'summary']);
      expect(store.listLatestMessagesWithPartsPage('root', 2).pagination.hasOlder).toBe(true);
      store.close?.();
    });
  });
}

runConversationContract('in-memory conversation store', createInMemoryConversationStore);
runConversationContract('SQLite conversation store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'capek-storage-'));
  temporaryDirectories.push(directory);
  return createSqliteConversationStore({ path: join(directory, 'conversation.sqlite') });
});

describe('storage persistence and queue contracts', () => {
  test('creates missing parent directories for SQLite paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'capek-nested-storage-'));
    temporaryDirectories.push(directory);
    const store = createSqliteConversationStore({
      path: join(directory, 'missing', 'nested', 'conversation.sqlite'),
    });

    store.createSession(session('root'));
    expect(store.getSession('root')?.id).toBe('root');
    store.close();
  });

  test('reopens SQLite and resumes sequence, child, and transcript state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'capek-reopen-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'conversation.sqlite');
    const first = createSqliteConversationStore({ path });
    first.createSession(session('root'));
    first.createSession(session('child-a', 'root'));
    first.createMessage(message('first', 'user', 1));
    first.close();

    const reopened = createSqliteConversationStore({ path });
    reopened.createMessage(message('second', 'user', 0));
    expect(reopened.listMessagesWithParts('root').map(entry => entry.message.id)).toEqual(['first', 'second']);
    expect(reopened.getChildSessions('root').map(child => child.id)).toEqual(['child-a']);
    reopened.close();
  });

  test('peeks then deletes queued messages in FIFO order', () => {
    const queue = createInMemoryMessageQueueStore();
    const first = queue.addMessage('root', 'first');
    queue.addMessage('root', 'second');
    expect(first.createdAt).toBeGreaterThan(0);
    expect(queue.peek('root')?.id).toBe(first.id);
    expect(queue.peek('root')?.id).toBe(first.id);
    expect(queue.delete(first.id)).toBe(true);
    expect(queue.peek('root')?.content).toBe('second');
  });
});
