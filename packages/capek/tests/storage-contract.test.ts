import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Message, Session, ToolPart } from '@capekai/types';
import {
  createInMemoryConversationStore,
  createInMemoryMessageQueueStore,
  createInMemoryToolOutputArtifactStore,
  createSqliteConversationStore,
  createSqliteToolOutputArtifactStore,
  MAX_TOOL_OUTPUT_PAGE_CHARS,
  type ClosableStore,
  type ConversationStore,
  type ToolOutputArtifactStore,
} from '@capekai/core/storage';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import {
  createPart as createRuntimePart,
  deleteMessage as deleteRuntimeMessage,
  syncMessageFts,
  updatePart as updateRuntimePart,
  withStorage,
} from '../src/storage/runtime';

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
    test('preserves deterministic ordering, snapshots, tool state, compaction, deletion, and child resume', async () => {
      const store = createStore();
      await store.createSession(session('root'));
      await store.createSession(session('child-b', 'root', '2026-01-01T00:00:01.000Z'));
      await store.createSession(session('child-a', 'root', '2026-01-01T00:00:01.000Z'));
      await store.createSession(session('orphan', 'missing-parent', '2026-01-01T00:00:01.000Z'));
      await store.updateSession('root', {
        runningAt: '2026-01-01T00:00:03.000Z',
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
        title: 'Updated',
        metadata: { goal: { status: 'active' } },
      });
      expect(await store.getSession('root')).toMatchObject({
        runningAt: '2026-01-01T00:00:03.000Z',
        promptTokens: 4,
        completionTokens: 2,
        totalTokens: 6,
        title: 'Updated',
        metadata: { goal: { status: 'active' } },
      });
      expect((await store.getChildSessions('root')).map(child => child.id)).toEqual(['child-b', 'child-a']);
      expect((await store.getSession('orphan'))?.parentId).toBe('missing-parent');

      await store.createMessage(message('old', 'user', 100));
      await store.createPart({ id: 'part-z', messageId: 'old', type: 'text', text: 'old-z', createdAt: 5 }, 'root');
      await store.createPart({ id: 'part-a', messageId: 'old', type: 'text', text: 'old-a', createdAt: 5 }, 'root');
      await store.createMessage(message('trigger', 'user', 50));
      await store.createPart({ id: 'trigger-part', messageId: 'trigger', type: 'compaction', auto: false, createdAt: 6 }, 'root');
      await store.createMessage(message('summary', 'assistant', 40, {
        summary: true,
        mode: 'compaction',
        parentId: 'trigger',
      }));
      await store.createPart({ id: 'summary-text', messageId: 'summary', type: 'text', text: 'summary', createdAt: 7 }, 'root');
      await store.createMessage(message('after', 'user', 30));
      await store.createPart({ id: 'stream', messageId: 'after', type: 'text', text: '', createdAt: 8 }, 'root');
      const tool: ToolPart = {
        id: 'tool',
        messageId: 'after',
        type: 'tool',
        callId: 'call-1',
        name: 'task',
        state: { status: 'pending', input: { task: true } },
        createdAt: 9,
      };
      await store.createPart(tool, 'root');
      await store.createPart({
        ...tool,
        id: 'duplicate-z',
        callId: 'duplicate-call',
        createdAt: 10,
      }, 'root');
      await store.createPart({
        ...tool,
        id: 'duplicate-a',
        callId: 'duplicate-call',
        createdAt: 10,
      }, 'root');

      expect((await store.listMessagesWithParts('root')).map(entry => entry.message.id)).toEqual([
        'old', 'trigger', 'summary', 'after',
      ]);
      expect((await store.getPartsByMessage('old')).map(part => part.id)).toEqual(['part-z', 'part-a']);
      await store.updatePart('part-z', { createdAt: 11 });
      expect((await store.getPartsByMessage('old')).map(part => part.id)).toEqual(['part-a', 'part-z']);
      expect((await store.getPartsBySession('root')).at(-1)?.id).toBe('part-z');
      await expect(store.createPart({
        id: 'wrong-session-part',
        messageId: 'old',
        type: 'text',
        text: 'wrong',
        createdAt: 5,
      }, 'child-a')).rejects.toThrow('Message does not exist in session: old');
      await expect(store.createPart({
        id: 'missing-message-part',
        messageId: 'missing',
        type: 'text',
        text: 'missing',
        createdAt: 5,
      }, 'root')).rejects.toThrow('Message does not exist in session: missing');
      expect(await store.persistStreamingPartSnapshots([
        { id: 'stream', messageId: 'after', sessionId: 'root', type: 'text', text: 'saved', createdAt: 8 },
        { id: 'stream', messageId: 'wrong', sessionId: 'root', type: 'text', text: 'wrong', createdAt: 8 },
      ])).toBe(1);
      expect(await store.getPart('stream')).toMatchObject({ text: 'saved' });

      const latestDuplicate = await store.transitionToolToRunningByCallId('root', 'duplicate-call');
      expect(latestDuplicate?.id).toBe('duplicate-a');
      expect((await store.getPart('duplicate-z') as ToolPart).state.status).toBe('pending');
      expect((await store.getPart('duplicate-a') as ToolPart).state.status).toBe('running');

      const running = await store.transitionToolToRunningByCallId('root', 'call-1', 'child-a');
      expect(running?.state).toMatchObject({ status: 'running', childSessionId: 'child-a' });
      const latest = await store.getPart('tool') as ToolPart;
      await store.updatePart('tool', {
        state: {
          status: 'completed',
          input: latest.state.input,
          output: 'done',
          startedAt: 'startedAt' in latest.state ? latest.state.startedAt : 0,
          completedAt: Date.now(),
          childSessionId: 'childSessionId' in latest.state ? latest.state.childSessionId : undefined,
        },
      });
      expect((await store.getPart('tool') as ToolPart).state).toMatchObject({
        status: 'completed',
        childSessionId: 'child-a',
      });
      const interrupted = await store.transitionToolToInterrupted('tool', 'cascade');
      expect(interrupted?.state).toMatchObject({
        status: 'interrupted',
        reason: 'cascade',
        childSessionId: 'child-a',
      });

      const history = await store.buildEffectiveContextHistory('root');
      expect(history.latestCompactionBoundary).toBe('trigger');
      expect(history.messages.map(entry => entry.message.id)).toEqual(['trigger', 'summary', 'after']);
      expect(await store.deleteMessage('after')).toBe(true);
      expect(await store.getPart('stream')).toBeNull();
      expect((await store.listLatestMessagesWithPartsPage('root', 2)).messages.map(entry => entry.message.id))
        .toEqual(['trigger', 'summary']);
      expect((await store.listLatestMessagesWithPartsPage('root', 2)).pagination.hasOlder).toBe(true);
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

describe('D2-017 FTS read-your-writes invariant', () => {
  test('indexes finalized part content after async writes and removes it on delete', async () => {
    const bundle = createInMemoryStorageBundle();
    const indexCalls: string[] = [];
    const indexedText = new Map<string, string>();
    bundle.index = {
      syncMessage: async (messageId) => {
        indexCalls.push(messageId);
        const entry = await bundle.conversation.getMessageWithParts(messageId);
        const text = entry?.parts
          .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
          .map(part => part.text)
          .join('') ?? '';
        indexedText.set(messageId, text);
      },
      removeMessage: async (messageId) => {
        indexedText.delete(messageId);
      },
    };

    await withStorage(bundle, async () => {
      await bundle.conversation.createSession(session('root'));
      await bundle.conversation.createMessage(message('fts-message', 'user', 100));
      await createRuntimePart({
        id: 'fts-part',
        messageId: 'fts-message',
        type: 'text',
        text: 'final content',
        createdAt: 101,
      }, 'root', { syncFts: false });
      await updateRuntimePart('fts-part', { text: 'finalized content' }, { syncFts: false });

      expect(indexCalls).toEqual([]);
      await syncMessageFts('fts-message');
      expect(indexCalls).toEqual(['fts-message']);
      expect(indexedText.get('fts-message')).toBe('finalized content');

      expect(await deleteRuntimeMessage('fts-message')).toBe(true);
      expect(indexedText.has('fts-message')).toBe(false);
    });
  });
});

function runToolOutputArtifactContract(name: string, createStore: () => ToolOutputArtifactStore & Partial<ClosableStore>): void {
  describe(name, () => {
    test('enforces opaque session scope and bounded character pages', async () => {
      const store = createStore();
      const artifact = await store.create({
        sessionId: 'root',
        workspaceId: 'workspace-1',
        toolCallId: 'call-1',
        toolName: 'synthetic',
        content: 'x'.repeat(MAX_TOOL_OUTPUT_PAGE_CHARS + 5),
        format: 'text',
      });

      expect(artifact.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(artifact.size).toBe(MAX_TOOL_OUTPUT_PAGE_CHARS + 5);
      expect(await store.getPage('root', 'malformed')).toBeNull();
      expect(await store.getPage('other', artifact.id)).toBeNull();
      expect(await store.getPage('root', crypto.randomUUID())).toBeNull();
      expect(await store.getPage('root', artifact.id, 0, MAX_TOOL_OUTPUT_PAGE_CHARS * 2)).toMatchObject({
        offset: 0,
        limit: MAX_TOOL_OUTPUT_PAGE_CHARS,
        totalChars: MAX_TOOL_OUTPUT_PAGE_CHARS + 5,
        nextOffset: MAX_TOOL_OUTPUT_PAGE_CHARS,
        complete: false,
      });
      expect(await store.getPage('root', artifact.id, MAX_TOOL_OUTPUT_PAGE_CHARS, 10)).toMatchObject({
        content: 'xxxxx',
        nextOffset: null,
        complete: true,
      });
      expect(await store.getPage('root', artifact.id, Number.MAX_SAFE_INTEGER, 10)).toMatchObject({
        content: '',
        offset: MAX_TOOL_OUTPUT_PAGE_CHARS + 5,
        complete: true,
      });
      store.close?.();
    });
  });
}

runToolOutputArtifactContract('in-memory tool output artifact store', createInMemoryToolOutputArtifactStore);
runToolOutputArtifactContract('SQLite tool output artifact store', () => {
  const directory = mkdtempSync(join(tmpdir(), 'capek-artifact-storage-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'conversation.sqlite');
  const conversation = createSqliteConversationStore({ path });
  conversation.createSession(session('root'));
  conversation.close();
  return createSqliteToolOutputArtifactStore({ path });
});

describe('storage persistence and queue contracts', () => {
  test('creates missing parent directories for SQLite paths', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'capek-nested-storage-'));
    temporaryDirectories.push(directory);
    const store = createSqliteConversationStore({
      path: join(directory, 'missing', 'nested', 'conversation.sqlite'),
    });

    await store.createSession(session('root'));
    expect((await store.getSession('root'))?.id).toBe('root');
    store.close();
  });

  test('reopens SQLite and resumes sequence, child, and transcript state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'capek-reopen-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'conversation.sqlite');
    const first = createSqliteConversationStore({ path });
    await first.createSession(session('root'));
    await first.createSession(session('child-a', 'root'));
    await first.createMessage(message('first', 'user', 1));
    first.close();

    const reopened = createSqliteConversationStore({ path });
    await reopened.createMessage(message('second', 'user', 0));
    expect((await reopened.listMessagesWithParts('root')).map(entry => entry.message.id)).toEqual(['first', 'second']);
    expect((await reopened.getChildSessions('root')).map(child => child.id)).toEqual(['child-a']);
    reopened.close();
  });

  test('reopens SQLite artifacts and cascades them with session deletion', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'capek-artifact-reopen-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'conversation.sqlite');
    const conversation = createSqliteConversationStore({ path });
    conversation.createSession(session('root'));
    const first = createSqliteToolOutputArtifactStore({ path });
    const artifact = await first.create({
      sessionId: 'root',
      toolCallId: 'call-1',
      toolName: 'synthetic',
      content: 'exact',
      format: 'text',
    });
    first.close();

    const reopened = createSqliteToolOutputArtifactStore({ path });
    expect((await reopened.getPage('root', artifact.id))?.content).toBe('exact');
    const db = new Database(path, { strict: true });
    db.exec('PRAGMA foreign_keys = ON');
    db.run('DELETE FROM capek_sessions WHERE id = ?', ['root']);
    db.close();
    expect(await reopened.getPage('root', artifact.id)).toBeNull();
    reopened.close();
    conversation.close();
  });

  test('peeks then deletes queued messages in FIFO order', async () => {
    const queue = createInMemoryMessageQueueStore();
    const first = await queue.addMessage('root', 'first');
    await queue.addMessage('root', 'second');
    expect(first.createdAt).toBeGreaterThan(0);
    expect((await queue.peek('root'))?.id).toBe(first.id);
    expect((await queue.peek('root'))?.id).toBe(first.id);
    expect(await queue.delete(first.id)).toBe(true);
    expect((await queue.peek('root'))?.content).toBe('second');
  });
});
