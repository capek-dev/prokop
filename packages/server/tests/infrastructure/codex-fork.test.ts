import { afterEach, beforeEach, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { bindCodexThread, getCodexBinding } from '@/harnesses/codex-cli/bindings';
import { getCodexModelSelection, saveCodexModelSelection } from '@/harnesses/codex-cli/models';
import { forkCodexSession, upstreamUserId } from '@/harnesses/codex-cli/fork';
import { createCodexExecution } from '@/harnesses/codex-cli/execution';
import { applyRollback, readRollbackHistory, saveRollbackIntent } from '@/harnesses/codex-cli/rollback';
import { CodexAppServer, type CodexConnection } from '@/harnesses/codex-cli/app-server';

const root = realpathSync(process.cwd());
const version = 'codex-cli 0.156.1';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: root }); });
afterEach(() => resetTestDatabase());

function seed(count = 3): { users: string[]; assistants: string[]; turns: Array<Record<string, unknown>> } {
  createSession({ id: 's', workspaceId: 'ws', title: 'Original', status: 'active',
    harness: 'codex-cli', preconfigId: 'test', metadata: null, parentId: null, agentName: null });
  bindCodexThread({ sessionId: 's', threadId: 'source', workspaceRoot: root, cliVersion: version });
  saveCodexModelSelection('s', { model: 'gpt-5-codex', effort: 'high' });
  const users: string[] = [];
  const assistants: string[] = [];
  const turns: Array<Record<string, unknown>> = [];
  for (let i = 0; i < count; i++) {
    const userId = `user-${i}`;
    const assistantId = `assistant-${i}`;
    createMessage({ id: userId, sessionId: 's', role: 'user', createdAt: i * 2 + 1 });
    createPart({ id: `part-${i}`, messageId: userId, type: 'text', text: `prompt ${i}`, createdAt: i * 2 + 1 }, 's');
    createMessage({ id: assistantId, sessionId: 's', role: 'assistant', status: 'completed',
      modelId: 'codex-cli', providerId: 'codex-cli', tokens: { prompt: 0, completion: 0 }, cost: 0,
      createdAt: i * 2 + 2 });
    users.push(userId);
    assistants.push(assistantId);
    turns.push({ id: `turn-${i}`, itemsView: 'full', status: 'completed',
      items: [{ type: 'userMessage', clientId: userId }] });
  }
  return { users, assistants, turns };
}

function fake(history: Record<string, Array<Record<string, unknown>>>, options: {
  rejectFork?: boolean; malformedFork?: boolean; goal?: unknown; completeTurn?: boolean;
} = {}): { connection: CodexConnection; sent: Array<Record<string, unknown>> } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Array<Record<string, unknown>> = [];
  const emit = (response: unknown): void => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(response)}\n`));
  const connection: CodexConnection = {
    stdout: new ReadableStream({ start(c) { controller = c; } }),
    stdin: { write(bytes) {
      const request = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      sent.push(request);
      const params = request.params as { threadId?: string; lastTurnId?: string } | undefined;
      if (request.method === 'initialize') queueMicrotask(() => emit({ id: request.id, result: {} }));
      if (request.method === 'thread/resume') queueMicrotask(() => emit({ id: request.id,
        result: { thread: { id: params?.threadId, status: { type: 'idle' } } } }));
      if (request.method === 'thread/goal/get') queueMicrotask(() => emit({ id: request.id,
        result: { goal: options.goal ?? null } }));
      if (request.method === 'thread/read') queueMicrotask(() => emit({ id: request.id,
        result: { thread: { id: params?.threadId, status: { type: 'idle' }, turns: history[params?.threadId ?? ''] } } }));
      if (request.method === 'turn/start' && options.completeTurn) queueMicrotask(() => {
        emit({ method: 'turn/started', params: { threadId: params?.threadId, turn: { id: 'new-turn' } } });
        emit({ id: request.id, result: { turn: { id: 'new-turn' } } });
        emit({ method: 'turn/completed', params: { threadId: params?.threadId,
          turn: { id: 'new-turn', status: 'completed' } } });
      });
      if (request.method === 'thread/fork') queueMicrotask(() => {
        if (options.rejectFork) { emit({ id: request.id, error: { code: -1, message: 'secret' } }); return; }
        const original = history[params?.threadId ?? ''] ?? [];
        const cutoff = original.findIndex(turn => turn.id === params?.lastTurnId);
        const forkId = `fork-${Object.keys(history).length}`;
        history[forkId] = options.malformedFork ? [] : original.slice(0, cutoff + 1);
        emit({ id: request.id, result: { thread: { id: forkId } } });
      });
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill() { try { controller.close(); } catch { /* already closed */ } },
  };
  return { connection, sent };
}

function deps(connection: CodexConnection) {
  return { connect: () => connection, version: () => version, root: () => root, busy: () => false };
}

test('native fork keeps selected assistant turn, binding, model and inherited user identities', async () => {
  const { users, assistants, turns } = seed();
  const history = { source: turns };
  const upstream = fake(history);
  const result = await forkCodexSession({ sessionId: 's', targetMessageId: assistants[1]! }, deps(upstream.connection));
  expect(upstream.sent.find(message => message.method === 'thread/fork')?.params).toMatchObject({
    threadId: 'source', lastTurnId: 'turn-1', cwd: root,
  });
  expect(result.forkedSession).toMatchObject({ harness: 'codex-cli', workspaceId: 'ws',
    title: 'Original (fork)', metadata: { forkedFrom: 's' } });
  const forkId = result.forkedSession.id;
  expect(getCodexBinding(forkId)).toMatchObject({ threadId: 'fork-1', pendingTurn: false,
    cliVersion: version, workspaceRoot: root });
  expect(getCodexModelSelection(forkId)).toEqual({ model: 'gpt-5-codex', effort: 'high' });
  const copy = listMessagesWithParts(forkId);
  expect(copy).toHaveLength(4);
  expect(copy[0]!.message.id).not.toBe(users[0]);
  expect(copy[0]!.parts[0]).toMatchObject({ text: 'prompt 0', messageId: copy[0]!.message.id });
  expect(upstreamUserId(copy[0]!.message.id)).toBe(users[0]);
  expect(upstreamUserId(copy[2]!.message.id)).toBe(users[1]);
  expect(listMessagesWithParts('s')).toHaveLength(6);
  const reader = fake(history);
  const client = new CodexAppServer(reader.connection, () => {});
  try { await client.initialize();
    expect(await readRollbackHistory(client, getCodexBinding(forkId)!)).toEqual(['turn-0', 'turn-1']);
  } finally { await client.close(); }
  expect(getDatabase().query('SELECT * FROM codex_fork_intents WHERE source_session_id = ?').get('s')).toBeNull();
});

test('new message in a fork resumes native forked history instead of starting an empty thread', async () => {
  const { assistants, turns } = seed(2);
  const history: Record<string, Array<Record<string, unknown>>> = { source: turns };
  const initial = fake(history);
  const { forkedSession } = await forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! },
    deps(initial.connection));
  const running = fake(history, { completeTurn: true });
  const execution = createCodexExecution({ connect: () => running.connection, version: () => version,
    instructions: {
      listPreconfigs: async () => [{ id: 'test', mode: 'primary', systemPrompt: 'Test' } as import('@prokopai/sdk').Preconfig],
      getPreconfig: async () => ({ id: 'test', systemPrompt: 'Test' }) as import('@prokopai/sdk').Preconfig,
      getAgentDirectory: async () => null,
      readAgentMemoryFile: async () => null,
    },
  });
  const events: unknown[] = [];
  const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
    send: (_origin: string, event: unknown) => { events.push(event); },
    broadcastToSession: (_id: string, event: unknown) => { events.push(event); },
  } } as unknown as import('@/application/ports/delivery').SessionWirePorts<string>;
  await execution.sendMessage(wire, 'origin', forkedSession.id, 'next question');
  expect(running.sent.some(entry => entry.method === 'thread/start')).toBe(false);
  expect(running.sent.find(entry => entry.method === 'thread/resume')?.params).toMatchObject({ threadId: 'fork-1' });
  expect(running.sent.find(entry => entry.method === 'turn/start')?.params).toMatchObject({ threadId: 'fork-1' });
  expect(listMessagesWithParts(forkedSession.id)).toHaveLength(4);
  expect(getCodexBinding(forkedSession.id)?.pendingTurn).toBe(false);
});

test('fork of a fork retains native client IDs and may fork its own later turn', async () => {
  const { assistants, turns } = seed(2);
  const history: Record<string, Array<Record<string, unknown>>> = { source: turns };
  const first = fake(history);
  const result = await forkCodexSession({ sessionId: 's', targetMessageId: assistants[1]! }, deps(first.connection));
  const copy = listMessagesWithParts(result.forkedSession.id);
  const second = fake(history);
  const nested = await forkCodexSession({ sessionId: result.forkedSession.id,
    targetMessageId: copy[1]!.message.id }, deps(second.connection));
  expect(upstreamUserId(listMessagesWithParts(nested.forkedSession.id)[0]!.message.id)).toBe('user-0');
  expect(getCodexBinding(nested.forkedSession.id)?.threadId).toBe('fork-2');
});

test('editing an inherited user replaces its upstream client identity before resubmission', async () => {
  const { assistants, turns } = seed(2);
  const upstream = fake({ source: turns });
  const { forkedSession } = await forkCodexSession({ sessionId: 's', targetMessageId: assistants[1]! },
    deps(upstream.connection));
  const messages = listMessagesWithParts(forkedSession.id);
  const userId = messages[0]!.message.id;
  expect(upstreamUserId(userId)).toBe('user-0');
  saveRollbackIntent({ sessionId: forkedSession.id, operation: 'edit', targetMessageId: userId,
    content: 'revised', beforeTurnId: 'turn-0', turnIds: ['turn-0', 'turn-1'], phase: 'rollback' });
  applyRollback({ sessionId: forkedSession.id, operation: 'edit', targetMessageId: userId,
    content: 'revised', beforeTurnId: 'turn-0', turnIds: ['turn-0', 'turn-1'], phase: 'rollback' });
  expect(upstreamUserId(userId)).toBe(userId);
  expect(listMessagesWithParts(forkedSession.id)).toHaveLength(1);
});

test('fork rejects user cutoff, images, pending turn, goals and incomplete history before native RPC', async () => {
  const { users, assistants, turns } = seed(1);
  const history = { source: turns };
  const user = fake(history);
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: users[0]! }, deps(user.connection)))
    .rejects.toThrow('completed assistant');
  expect(user.sent.some(message => message.method === 'thread/fork')).toBe(false);
  createPart({ id: 'image', messageId: users[0]!, type: 'image', url: '/source-image', mimeType: 'image/png', createdAt: 1 }, 's');
  const image = fake(history);
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(image.connection)))
    .rejects.toThrow('image history');
  getDatabase().run('UPDATE codex_session_bindings SET pending_turn = 1 WHERE session_id = ?', ['s']);
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! },
    { ...deps(image.connection), connect: () => { throw new Error('spawned'); } })).rejects.toThrow('requires recovery');
  getDatabase().run('UPDATE codex_session_bindings SET pending_turn = 0 WHERE session_id = ?', ['s']);
  const goal = fake(history, { goal: { status: 'active' } });
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(goal.connection)))
    .rejects.toThrow('goal history');
  const incomplete = fake({ source: [{ ...turns[0], itemsView: 'summary' }] });
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(incomplete.connection)))
    .rejects.toThrow('incomplete');
});

test('failed local copy rolls back the new binding and retains the uncertain native fork intent', async () => {
  const { assistants, turns } = seed(1);
  getDatabase().run(`CREATE TRIGGER fail_fork_copy BEFORE INSERT ON messages
    WHEN NEW.session_id != 's' BEGIN SELECT RAISE(ABORT, 'copy failed'); END`);
  const history = { source: turns };
  const upstream = fake(history);
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(upstream.connection)))
    .rejects.toThrow('copy failed');
  expect(getDatabase().query('SELECT id FROM sessions WHERE id != ?').all('s')).toEqual([]);
  expect(getDatabase().query('SELECT thread_id FROM codex_session_bindings').all()).toHaveLength(1);
  expect(getDatabase().query('SELECT * FROM codex_fork_intents WHERE source_session_id = ?').get('s')).not.toBeNull();
});

test('execution reports an uncertain native fork without exposing upstream errors', async () => {
  const { assistants, turns } = seed(1);
  const upstream = fake({ source: turns }, { rejectFork: true });
  const execution = createCodexExecution({ connect: () => upstream.connection, version: () => version,
    instructions: {
      listPreconfigs: async () => [], getPreconfig: async () => null,
      getAgentDirectory: async () => null, readAgentMemoryFile: async () => null,
    },
  });
  await expect(execution.fork({ sessionId: 's', targetMessageId: assistants[0]! }))
    .rejects.toThrow('Codex fork outcome is uncertain; do not retry in this session');
  expect(getDatabase().query('SELECT * FROM codex_fork_intents WHERE source_session_id = ?').get('s')).not.toBeNull();
});

test('uncertain or invalid native fork never publishes a local session or retries the RPC', async () => {
  const { assistants, turns } = seed(1);
  const history = { source: turns };
  const upstream = fake(history, { malformedFork: true });
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(upstream.connection)))
    .rejects.toThrow('history does not match');
  expect(getDatabase().query('SELECT * FROM codex_fork_intents WHERE source_session_id = ?').get('s')).not.toBeNull();
  expect(getCodexBinding('s')?.threadId).toBe('source');
  const retry = fake(history);
  await expect(forkCodexSession({ sessionId: 's', targetMessageId: assistants[0]! }, deps(retry.connection)))
    .rejects.toThrow('uncertain outcome');
  expect(retry.sent).toHaveLength(0);
  expect(getSession('s')?.harness).toBe('codex-cli');
});
