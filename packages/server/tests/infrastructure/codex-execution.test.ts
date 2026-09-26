import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { getCodexBinding } from '@/harnesses/codex-cli/bindings';
import { saveCodexModelSelection } from '@/harnesses/codex-cli/models';
import { createCodexExecution } from '@/harnesses/codex-cli/execution';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';
import type { ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

function create(harness: 'prokop' | 'codex-cli' = 'codex-cli'): void {
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness });
}

function fakeCodex(readThread?: () => unknown, rejectMethod?: string): { connection: CodexConnection; sent: Record<string, unknown>[]; send(message: unknown): void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const sent: Record<string, unknown>[] = [];
  const connection: CodexConnection = {
    stdout: new ReadableStream({ start(c) { controller = c; } }),
    stdin: { write(bytes) {
      const message = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
      sent.push(message);
      if (message.method === rejectMethod) {
        queueMicrotask(() => send({ id: message.id, error: { code: -32602, message: 'secret upstream detail' } }));
        return bytes.length;
      }
      if (message.method === 'initialize') queueMicrotask(() => send({ id: message.id, result: {} }));
      if (message.method === 'thread/start' || message.method === 'thread/resume') {
        queueMicrotask(() => send({ id: message.id, result: { thread: { id: 'thread-1' }, model: 'gpt-5-codex' } }));
      }
      if (message.method === 'thread/read' && readThread) {
        queueMicrotask(() => send({ id: message.id, result: { thread: readThread() } }));
      }
      if (message.method === 'turn/start') {
        queueMicrotask(() => send({ id: message.id, result: { turn: { id: 'turn-1' } } }));
      }
      if (message.method === 'turn/interrupt') queueMicrotask(() => send({ id: message.id, result: {} }));
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill: () => { try { controller.close(); } catch { /* Already closed. */ } },
  };
  function send(message: unknown): void {
    controller.enqueue(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  }
  return { connection, sent, send };
}

function wire(messages: ServerMessage[]): SessionWirePorts<string> {
  return {
    actor: { attachOriginToSession: () => {} },
    delivery: {
      send: (_origin, message) => messages.push(message),
      broadcast: message => messages.push(message),
      broadcastToSession: (_id, message) => messages.push(message),
      sendToController: (_id, message) => messages.push(message),
      sendToAskTargets: (_id, _authority, message) => messages.push(message),
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await Bun.sleep(1);
  expect(predicate()).toBe(true);
}

test('Codex turn applies selected model and effort, streams, and resumes its thread', async () => {
  create();
  saveCodexModelSelection('s', { model: 'gpt-5-codex', effort: 'low' });
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(); processes.push(fake); return fake.connection;
  } });
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const current = processes[0]!;
  expect(current.sent.find(message => message.method === 'thread/start')).toMatchObject({
    params: { cwd: process.cwd(), approvalPolicy: 'on-request', sandbox: 'workspace-write', model: 'gpt-5-codex' },
  });
  expect(current.sent.find(message => message.method === 'turn/start')).toMatchObject({
    params: { model: 'gpt-5-codex', effort: 'low' },
  });
  expect(getSession('s')?.selectedModel).toBe('gpt-5-codex');
  current.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  current.send({ method: 'model/rerouted', params: {
    threadId: 'thread-1', turnId: 'turn-1', fromModel: 'gpt-5-codex', toModel: 'gpt-5.1-codex', reason: 'policy',
  } });
  current.send({ method: 'model/rerouted', params: {
    threadId: 'other', turnId: 'turn-1', fromModel: 'gpt-5.1-codex', toModel: 'wrong', reason: 'policy',
  } });
  current.send({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'Hi' } });
  current.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'item-1', type: 'agentMessage', text: 'Hi!' } } });
  current.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await first;
  expect(getCodexBinding('s')).toMatchObject({ threadId: 'thread-1', cliVersion: 'codex-cli 0.156.1' });
  expect(getSession('s')?.selectedModel).toBe('gpt-5.1-codex');
  expect(messages.map(message => message.type)).toEqual([
    'message.created', 'part.created', 'message.created', 'session.updated', 'message.updated',
    'session.updated', 'message.updated', 'part.created', 'part.append', 'part.updated', 'message.updated',
  ]);
  expect(messages.filter(message => message.type === 'session.updated').map(message => message.session.selectedModel))
    .toEqual(['gpt-5-codex', 'gpt-5.1-codex']);
  expect(listMessagesWithParts('s')[1]?.message).toMatchObject({ modelId: 'gpt-5.1-codex' });
  expect(listMessagesWithParts('s').map(row => row.parts.filter(part => part.type === 'text').map(part => part.text)))
    .toEqual([['hello'], ['Hi!']]);
  const second = execution.sendMessage(wire(messages), 'origin', 's', 'again');
  await waitFor(() => processes[1]?.sent.some(message => message.method === 'turn/start') ?? false);
  expect(processes[1]!.sent.some(message => message.method === 'thread/resume')).toBe(true);
  processes[1]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  processes[1]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await second;
});

test('workspace memory is opt-in and refreshed in Codex thread instructions on resume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-'));
  try {
    updateWorkspace('ws', { path: root });
    create();
    const directory = join(root, '.prokopai');
    mkdirSync(directory);
    writeFileSync(join(directory, 'USER.md'), '- prefer focused tests');
    writeFileSync(join(directory, 'MEMORY.md'), '- first fact');
    const processes: ReturnType<typeof fakeCodex>[] = [];
    const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
      const fake = fakeCodex(); processes.push(fake); return fake.connection;
    } });
    const messages: ServerMessage[] = [];
    const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
    await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
    expect((processes[0]!.sent.find(message => message.method === 'thread/start')?.params as Record<string, unknown>)
      .developerInstructions).toBeUndefined();
    processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes[0]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await first;

    updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'low' } } });
    const second = execution.sendMessage(wire(messages), 'origin', 's', 'again');
    await waitFor(() => processes[1]?.sent.some(message => message.method === 'turn/start') ?? false);
    const instructions = (processes[1]!.sent.find(message => message.method === 'thread/resume')?.params as Record<string, unknown>)
      .developerInstructions as string;
    expect(instructions).toContain('<user_memory path="USER.md"');
    expect(instructions).toContain('- prefer focused tests');
    expect(instructions).toContain('<workspace_memory path="MEMORY.md"');
    expect(instructions).toContain('- first fact');
    expect(instructions).not.toContain('preconfig');
    expect((processes[1]!.sent.find(message => message.method === 'turn/start')?.params as Record<string, unknown>)
      .developerInstructions).toBeUndefined();
    processes[1]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes[1]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await second;

    writeFileSync(join(directory, 'MEMORY.md'), '- changed fact');
    const third = execution.sendMessage(wire(messages), 'origin', 's', 'third');
    await waitFor(() => processes[2]?.sent.some(message => message.method === 'turn/start') ?? false);
    const refreshed = (processes[2]!.sent.find(message => message.method === 'thread/resume')?.params as Record<string, unknown>)
      .developerInstructions as string;
    expect(refreshed).toContain('- changed fact');
    expect(refreshed).not.toContain('- first fact');
    processes[2]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes[2]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await third;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('enabled workspace memory is sent on thread creation and oversized files are omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-memory-'));
  try {
    updateWorkspace('ws', { path: root, settings: { memory: { enabled: true, permissionRisk: 'low' } } });
    create();
    const directory = join(root, '.prokopai');
    mkdirSync(directory);
    writeFileSync(join(directory, 'USER.md'), '- use simple examples');
    writeFileSync(join(directory, 'MEMORY.md'), 'x'.repeat(2501));
    const fake = fakeCodex();
    const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
    const pending = execution.sendMessage(wire([]), 'origin', 's', 'hello');
    await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
    const instructions = (fake.sent.find(message => message.method === 'thread/start')?.params as Record<string, unknown>)
      .developerInstructions as string;
    expect(instructions).toContain('- use simple examples');
    expect(instructions).not.toContain('<workspace_memory');
    fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await pending;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a rejected thread request reports its stage without leaking upstream details', async () => {
  create();
  const messages: ServerMessage[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => fakeCodex(undefined, 'thread/start').connection });
  await execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  const error = messages.find(message => message.type === 'error');
  expect(error).toMatchObject({ type: 'error', message: 'Codex failed during thread creation (RPC -32602). Check the host CLI setup.' });
  expect(JSON.stringify(messages)).not.toContain('secret upstream detail');
  expect(getCodexBinding('s')).toBeNull();
});

test('interruption waits for the terminal notification before allowing another turn', async () => {
  create();
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(); processes.push(fake); return fake.connection;
  } });
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const current = processes[0]!;
  current.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => execution.isSessionActive('s'));
  await execution.interruptSession('s');
  expect(current.sent.some(message => message.method === 'turn/interrupt')).toBe(true);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  current.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  await first;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
  expect(execution.isSessionActive('s')).toBe(false);
});

test('an uncertain turn is never replayed when history cannot prove completion', async () => {
  create();
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [] }));
    processes.push(fake); return fake.connection;
  } };
  const execution = createCodexExecution(deps);
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const concurrent = execution.sendMessage(wire(messages), 'origin', 's', 'duplicate');
  await concurrent;
  expect(processes).toHaveLength(1);
  expect(messages.some(message => message.type === 'error')).toBe(true);
  processes[0]!.connection.kill();
  await first;
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  const count = listMessagesWithParts('s').length;
  await createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'again');
  expect(processes).toHaveLength(2);
  expect(processes[1]!.sent.some(message => message.method === 'turn/start')).toBe(false);
  expect(listMessagesWithParts('s')).toHaveLength(count);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
});

test('restart recovers a finished turn by client user ID without replaying it', async () => {
  create();
  const processes: ReturnType<typeof fakeCodex>[] = [];
  let lostUserId: string | null = null;
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [{
      id: 'turn-1', status: 'completed', itemsView: 'full', items: [
        { type: 'userMessage', id: 'u', clientId: lostUserId },
        { type: 'agentMessage', id: 'a', text: 'Recovered answer' },
      ],
    }] }));
    processes.push(fake); return fake.connection;
  } };
  const messages: ServerMessage[] = [];
  const first = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const start = processes[0]!.sent.find(message => message.method === 'turn/start')!;
  lostUserId = (start.params as { clientUserMessageId: string }).clientUserMessageId;
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  processes[0]!.send({ method: 'item/agentMessage/delta', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'a', delta: 'Partial',
  } });
  await waitFor(() => listMessagesWithParts('s')[1]?.parts.length === 1);
  processes[0]!.connection.kill();
  await first;
  expect(getCodexBinding('s')?.pendingUserId).toBe(lostUserId);
  const next = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'next');
  await waitFor(() => processes[2]?.sent.some(message => message.method === 'turn/start') ?? false);
  expect(processes[1]!.sent.map(message => message.method)).toContain('thread/read');
  expect(processes[1]!.sent.some(message => message.method === 'turn/start')).toBe(false);
  expect(getCodexBinding('s')?.pendingUserId).not.toBe(lostUserId);
  expect(listMessagesWithParts('s')[1]?.parts.map(part => part.type === 'text' ? part.text : '')).toEqual(['Recovered answer']);
  expect(listMessagesWithParts('s')[1]?.message).toMatchObject({ status: 'completed' });
  processes[2]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  processes[2]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await next;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('a Prokop session cannot spawn or route into Codex', async () => {
  create('prokop');
  let launches = 0;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    launches++;
    return fakeCodex().connection;
  } });
  const messages: ServerMessage[] = [];
  await execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  expect(launches).toBe(0);
  expect(messages[0]?.type).toBe('error');
  expect(getSession('s')?.harness).toBe('prokop');
});
