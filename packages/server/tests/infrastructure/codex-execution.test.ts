import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { createAttachment } from '@/infrastructure/sqlite/attachments';
import { Paths } from '@/infrastructure/runtime/paths';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createMessage, createPart, listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { projectMessagesForClient } from '@/application/sessions/tool-debug';
import { bindCodexThread, getCodexBinding } from '@/harnesses/codex-cli/bindings';
import { getRollbackIntent } from '@/harnesses/codex-cli/rollback';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { CodexApprovals, canAutoApproveCodexHook, codexApprovals } from '@/harnesses/codex-cli/approvals';
import { getPermissionRequestByRequestId, listPendingAsksBySession,
  listPendingRequestsByRootSession } from '@/infrastructure/sqlite/pending-asks';
import { saveCodexModelSelection } from '@/harnesses/codex-cli/models';
import { createCodexExecution as createExecution, type CodexExecutionDependencies } from '@/harnesses/codex-cli/execution';
import { hookCommand, type HookDecision } from '@/harnesses/codex-cli/pretool-hook';
import type { CodexHookCall } from '@/harnesses/codex-cli/hook-policy';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';
import type { PermissionAsk, ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

function create(harness: 'prokop' | 'codex-cli' = 'codex-cli'): void {
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: harness === 'codex-cli' ? 'test' : null, metadata: null, parentId: null, agentName: null, harness });
}

function createCodexExecution(deps: Omit<CodexExecutionDependencies, 'instructions'> &
  { instructions?: CodexExecutionDependencies['instructions'] }) {
  return createExecution({ ...deps, instructions: deps.instructions ?? {
    listPreconfigs: async () => [{ id: 'test', mode: 'primary', systemPrompt: 'Test instruction' } as import('@prokopai/sdk').Preconfig],
    getPreconfig: async id => id === 'test' ? { id, systemPrompt: 'Test instruction' } as import('@prokopai/sdk').Preconfig : null,
    getAgentDirectory: async () => null,
    readAgentMemoryFile: async () => null,
  } });
}

function fakeCodex(readThread?: () => unknown, rejectMethod?: string, trustedHook = false,
  readGoal?: () => unknown, deferActiveGoal = false,
  deferTurnStart = false, deferPauseGoal = false, revertThread?: (beforeTurnId: string) => void,
  resumeStatus: 'idle' | 'active' = 'idle', uniqueTurnIds = false):
  { connection: CodexConnection; sent: Record<string, unknown>[]; send(message: unknown): void } {
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
      if (message.method === 'hooks/list' && trustedHook) queueMicrotask(() => send({ id: message.id, result: {
        data: [{ hooks: [{ key: '/<session-flags>/config.toml:pre_tool_use:0:0',
          currentHash: `sha256:${'a'.repeat(64)}`, eventName: 'preToolUse', source: 'sessionFlags',
          enabled: true, trustStatus: 'trusted', matcher: '^(Bash|apply_patch)$', command: hookCommand() }],
        warnings: [], errors: [] }],
      } }));
      if (message.method === 'thread/start' || message.method === 'thread/resume') {
        const tools = (message.params as { dynamicTools?: unknown })?.dynamicTools;
        const init = sent.find(entry => entry.method === 'initialize');
        const capabilities = (init?.params as { capabilities?: { experimentalApi?: boolean } })?.capabilities;
        queueMicrotask(() => send(tools !== undefined && capabilities?.experimentalApi !== true
          ? { id: message.id, error: { code: -32600, message: 'Experimental API is not enabled' } }
          : { id: message.id, result: { thread: { id: 'thread-1', status: { type: message.method === 'thread/resume'
            ? resumeStatus : 'idle' } }, model: 'gpt-5-codex' } }));
      }
      if (message.method === 'thread/read' && readThread) {
        queueMicrotask(() => send({ id: message.id, result: { thread: readThread() } }));
      }
      if (message.method === 'thread/revert' && revertThread) {
        queueMicrotask(() => {
          revertThread((message.params as { beforeTurnId: string }).beforeTurnId);
          send({ id: message.id, result: { thread: { id: 'thread-1', turns: [] },
            turnsBackwardsCursor: null, itemsBackwardsCursor: null } });
        });
      }
      if (message.method === 'thread/goal/get') queueMicrotask(() => send({ id: message.id, result: {
        goal: readGoal ? readGoal() : { threadId: 'thread-1', objective: 'Ship it', status: 'active',
          tokenBudget: 50000, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 },
      } }));
      if (message.method === 'turn/start' && !deferTurnStart) {
        const turnId = uniqueTurnIds ? `turn-${sent.filter(entry => entry.method === 'turn/start').length}` : 'turn-1';
        queueMicrotask(() => send({ id: message.id, result: { turn: { id: turnId } } }));
      }
      if (message.method === 'turn/interrupt') queueMicrotask(() => send({ id: message.id, result: {} }));
      if (message.method === 'thread/goal/set' && !(deferActiveGoal
        && (message.params as { status: string }).status === 'active') && !(deferPauseGoal
        && (message.params as { status: string }).status === 'paused')) queueMicrotask(() => send({ id: message.id, result: { goal: {
        threadId: 'thread-1', objective: 'Ship it',
        status: (message.params as { status: string }).status, tokenBudget: 50000,
        tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
      } } }));
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

test('Codex sends session images as localImage inputs and persists image-only thumbnails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-images-'));
  Paths.configure({ dataDir: dir });
  try {
    create();
    const first = createAttachment({ sessionId: 's', workspaceId: 'ws', filename: 'first.png',
      mimeType: 'image/png', sizeBytes: 3, data: new Uint8Array([1, 2, 3]).buffer });
    const second = createAttachment({ sessionId: 's', workspaceId: 'ws', filename: 'second.webp',
      mimeType: 'image/webp', sizeBytes: 2, data: new Uint8Array([4, 5]).buffer });
    const processes: ReturnType<typeof fakeCodex>[] = [];
    const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
      const fake = fakeCodex(); processes.push(fake); return fake.connection;
    } });
    const messages: ServerMessage[] = [];
    const send = (text: string, ids: string[]) => execution.sendMessage(wire(messages), 'origin', 's', text,
      ids.map(id => ({ id, kind: 'image' })));
    const turn = send('Describe these', [first.id, second.id]);
    await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
    expect(processes[0]!.sent.find(message => message.method === 'turn/start')?.params).toMatchObject({
      input: [{ type: 'text', text: 'Describe these' }, { type: 'localImage', path: realpathSync(first.absolutePath) },
        { type: 'localImage', path: realpathSync(second.absolutePath) }],
    });
    const parts = listMessagesWithParts('s')[0]!.parts;
    expect(parts.filter(part => part.type === 'image')).toMatchObject([
      { type: 'image', mimeType: 'image/png', url: `/api/sessions/s/attachments/${first.id}/content?key=${first.accessKey}` },
      { type: 'image', mimeType: 'image/webp', url: `/api/sessions/s/attachments/${second.id}/content?key=${second.accessKey}` },
    ]);
    processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes[0]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await turn;
    const imageOnly = send('', [first.id]);
    await waitFor(() => processes[1]?.sent.some(message => message.method === 'turn/start') ?? false);
    expect(processes[1]!.sent.find(message => message.method === 'turn/start')?.params).toMatchObject({
      input: [{ type: 'localImage', path: realpathSync(first.absolutePath) }],
    });
    expect(listMessagesWithParts('s').filter(entry => entry.message.role === 'user')[1]!.parts.map(part => part.type))
      .toEqual(['image']);
    processes[1]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes[1]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
    await imageOnly;
  } finally {
    Paths.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex rejects invalid image references before creating a turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-images-invalid-'));
  Paths.configure({ dataDir: dir });
  try {
    create();
    createSession({ id: 'other', workspaceId: 'ws', title: 'Other', status: 'active',
      preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
    const image = createAttachment({ sessionId: 's', workspaceId: 'ws', filename: 'valid.png',
      mimeType: 'image/png', sizeBytes: 1, data: new Uint8Array([1]).buffer });
    const foreign = createAttachment({ sessionId: 'other', workspaceId: 'ws', filename: 'foreign.png',
      mimeType: 'image/png', sizeBytes: 1, data: new Uint8Array([1]).buffer });
    const file = createAttachment({ sessionId: 's', workspaceId: 'ws', filename: 'note.txt',
      mimeType: 'text/plain', sizeBytes: 1, data: new Uint8Array([1]).buffer });
    const messages: ServerMessage[] = [];
    const execution = createCodexExecution({ version: () => { throw new Error('must not start'); },
      connect: () => { throw new Error('must not connect'); } });
    const reject = async (refs: Array<{ id: string; kind: string }>) => {
      await execution.sendMessage(wire(messages), 'origin', 's', 'hello', refs);
      expect(messages.at(-1)).toMatchObject({ type: 'error', code: 'invalid_session' });
      expect(listMessagesWithParts('s')).toHaveLength(0);
    };
    await reject([{ id: 'missing', kind: 'image' }]);
    await reject([{ id: foreign.id, kind: 'image' }]);
    await reject([{ id: file.id, kind: 'image' }]);
    await reject([{ id: image.id, kind: 'file' }]);
    await reject([{ id: image.id, kind: 'image' }, { id: 'missing', kind: 'image' }]);
    getDatabase().run('UPDATE attachments SET mime_type = ? WHERE id = ?', ['image/svg+xml', image.id]);
    await reject([{ id: image.id, kind: 'image' }]);
    getDatabase().run('UPDATE attachments SET mime_type = ? WHERE id = ?', ['image/png', image.id]);
    getDatabase().run('UPDATE attachments SET absolute_path = ? WHERE id = ?', [file.absolutePath, image.id]);
    await reject([{ id: image.id, kind: 'image' }]);
    getDatabase().run('UPDATE attachments SET absolute_path = ? WHERE id = ?', [image.absolutePath, image.id]);
    unlinkSync(image.absolutePath);
    await reject([{ id: image.id, kind: 'image' }]);
    symlinkSync(file.absolutePath, image.absolutePath);
    await reject([{ id: image.id, kind: 'image' }]);
  } finally {
    Paths.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  expect((current.sent.find(message => message.method === 'thread/start')?.params as Record<string, unknown>))
    .not.toHaveProperty('dynamicTools');
  expect(current.sent.find(message => message.method === 'initialize')?.params)
    .toMatchObject({ capabilities: null });
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
      .developerInstructions).toContain('Test instruction');
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
    expect(instructions).toContain('Test instruction');
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

test('Codex tool items appear in the transcript and settle on completion or process loss', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const turn = execution.sendMessage(wire(messages), 'origin', 's', 'run tools');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  const command = { type: 'commandExecution', id: 'cmd-1', command: 'git status', cwd: process.cwd(), status: 'inProgress' };
  fake.send({ method: 'item/started', params: { threadId: 'other', turnId: 'turn-1', item: command } });
  fake.send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: command } });
  fake.send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: command } });
  await waitFor(() => messages.some(message => message.type === 'part.created' && message.part.type === 'tool'));
  expect(listMessagesWithParts('s')[1]?.parts.filter(part => part.type === 'tool')).toHaveLength(1);
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    ...command, status: 'completed', aggregatedOutput: 'clean', exitCode: 0,
  } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'fileChange', id: 'file-1', status: 'completed',
    changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '@@ -1 +1 @@\n-old line\n+new line' }],
  } } });
  fake.send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'mcpToolCall', id: 'mcp-1', server: 'docs', tool: 'search', status: 'inProgress', arguments: { q: 'x' },
  } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'dynamicToolCall', id: 'dynamic-1', tool: 'fetch', status: 'failed', arguments: {},
  } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'dynamicToolCall', id: 'memory-1', tool: 'memory', namespace: null,
    status: 'completed', arguments: { action: 'list', target: 'memory' },
    contentItems: [{ type: 'inputText', text: JSON.stringify({ target: 'memory', action: 'list',
      usage: { chars: 71, limit: 2500 },
      entries: ['[0] first fact', '[1] ![untrusted](https://example.com/image.png)'] }) }],
  } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'dynamicToolCall', id: 'search-1', tool: 'session_search', namespace: null, status: 'completed',
    arguments: { action: 'search', query: 'example' }, contentItems: [{ type: 'inputText', text: JSON.stringify({
      success: true, mode: 'search', title: 'Searched workspace sessions', query: 'example', results: [{
        sessionId: 's', sessionTitle: 'Earlier work', snippet: '![untrusted](https://example.com/image.png)',
      }],
    }) }],
  } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
    type: 'dynamicToolCall', id: 'other-1', tool: 'example', status: 'completed', arguments: {},
    contentItems: [{ type: 'inputText', text: 'plain result' }],
  } } });
  await waitFor(() => listMessagesWithParts('s')[1]?.parts.filter(part => part.type === 'tool').length === 7);
  fake.connection.kill();
  await turn;
  const tools = listMessagesWithParts('s')[1]!.parts.filter(part => part.type === 'tool');
  expect(tools.map(part => [part.name, part.state.status]).sort()).toEqual([
    ['Codex command', 'completed'], ['Codex file change', 'completed'],
    ['Codex MCP', 'interrupted'], ['Codex tool', 'error'],
    ['Codex tool', 'completed'], ['memory', 'completed'], ['session_search', 'completed'],
  ].sort());
  expect(tools.find(part => part.name === 'Codex command')?.state)
    .toMatchObject({ output: { exitCode: 0, _visualization: { type: 'shell-output', stdout: 'clean' } } });
  expect(tools.find(part => part.name === 'Codex file change')?.presentation?.summary).toContain('src/a.ts');
  const fileChange = tools.find(part => part.name === 'Codex file change');
  expect(fileChange?.state).toMatchObject({ output: { _visualization: {
    type: 'diff', path: 'src/a.ts', additions: 1, deletions: 1,
    hunks: [{ oldStart: 1, newStart: 1, changes: [
      { type: 'removed', content: 'old line' }, { type: 'added', content: 'new line' },
    ] }],
  } } });
  expect(tools.find(part => part.callId === 'codex-item:turn-1:search-1')).toMatchObject({
    name: 'session_search', presentation: { summary: 'search example' },
    state: { output: { _visualization: { type: 'file-list', badge: '1 result',
      singularLabel: 'result', pluralLabel: 'results', title: 'example',
      files: [{ path: 'Earlier work' }], total: 1 } } },
  });
  expect(tools.find(part => part.callId === 'codex-item:turn-1:memory-1')).toMatchObject({
    name: 'memory', presentation: { summary: 'list memory' },
    state: { output: { _visualization: { type: 'none', badge: '2 entries · 71/2500 chars',
      message: 'Memory (memory)' } } },
  });
  expect(tools.find(part => part.callId === 'codex-item:turn-1:other-1')?.state).toMatchObject({
    output: { _visualization: { type: 'markdown', content: 'plain result' } },
  });
  expect(messages.filter(message => message.type === 'part.created' && message.part.type === 'tool')).toHaveLength(7);
  expect(messages.filter(message => message.type === 'part.updated' && message.part.type === 'tool')).toHaveLength(7);
});

test('Codex command approval uses ask UI, exact session grants and one-time replies', async () => {
  create();
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(); processes.push(fake); return fake.connection;
  } });
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const fake = processes[0]!;
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ id: 88, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'git status', cwd: process.cwd(),
  } });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const ask = messages.find(message => message.type === 'ask.request')!;
  expect(ask.ask).toMatchObject({ risk: 'critical', allowedScopes: ['once', 'session', 'workspace'],
    metadata: { command: 'git status' } });
  expect(codexApprovals.getSessionId(ask.toolCallId, ask.requestId)).toBe('s');
  expect(codexApprovals.getSessionId(ask.toolCallId, 'wrong')).toBeNull();
  expect(await codexApprovals.resolve(ask.toolCallId, { type: 'permission', grant: 'session' }, ask.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 88));
  expect(fake.sent.find(message => message.id === 88)?.result).toEqual({ decision: 'accept' });
  expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('approved');
  fake.send({ id: 89, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-2', command: 'git status', cwd: process.cwd(),
  } });
  await waitFor(() => fake.sent.some(message => message.id === 89));
  expect(fake.sent.find(message => message.id === 89)?.result).toEqual({ decision: 'accept' });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  fake.send({ id: 90, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-3', command: 'git diff', cwd: process.cwd(),
  } });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 2);
  const other = messages.filter(message => message.type === 'ask.request')[1]!;
  expect(await codexApprovals.resolve(other.toolCallId, { type: 'permission', grant: 'once' }, other.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 90));
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await first;
});

test('trusted hook asks through the turn, denies invalid identity, and hands an approved call to native escalation once', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, true);
  const messages: ServerMessage[] = [];
  let onCall!: (call: CodexHookCall) => Promise<HookDecision>;
  let closed = false;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { throw new Error('Protected turns must not use the bare connection'); },
    prepareHook: async callback => {
      onCall = callback;
      return { connect: () => fake.connection, close: async () => { closed = true; } };
    },
  });
  const turn = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => execution.isSessionActive('s'));
  const call: CodexHookCall = { session_id: 'thread-1', turn_id: 'turn-1', tool_use_id: 'item-1',
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: process.cwd(), tool_input: { command: 'rm -rf ./generated' } };
  expect(await onCall({ ...call, turn_id: 'other' })).toBe('no-active-turn');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(0);
  const denied = onCall(call);
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 1);
  const firstAsk = messages.find(message => message.type === 'ask.request')!;
  expect(firstAsk.ask).toMatchObject({ allowedScopes: ['once'], action: 'delete' });
  expect(await codexApprovals.resolve(firstAsk.toolCallId, { type: 'permission', grant: 'denied' }, firstAsk.requestId)).toBe(true);
  expect(await denied).toBe('permission-denied');
  const approved = onCall(call);
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 2);
  const secondAsk = messages.filter(message => message.type === 'ask.request')[1]!;
  expect(codexApprovals.getSessionId(secondAsk.toolCallId, secondAsk.requestId)).toBe('s');
  expect(await codexApprovals.resolve(secondAsk.toolCallId, { type: 'permission', grant: 'once' }, secondAsk.requestId)).toBe(true);
  expect(await approved).toBe(true);
  fake.send({ id: 88, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', cwd: process.cwd(), command: 'rm -rf ./generated',
  } });
  await waitFor(() => fake.sent.some(message => message.id === 88));
  expect(fake.sent.find(message => message.id === 88)?.result).toEqual({ decision: 'accept' });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(2);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await turn;
  expect(closed).toBe(true);
});

test('Codex hook accepts only spawned child threads in the selected root for the active turn', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, true);
  const messages: ServerMessage[] = [];
  const askTargetSessions: string[] = [];
  const childWire = wire(messages);
  childWire.delivery.sendToAskTargets = (id, _authority, message) => {
    askTargetSessions.push(id);
    messages.push(message);
  };
  let onCall!: (call: CodexHookCall) => Promise<HookDecision>;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { throw new Error('Protected turns must not use the bare connection'); },
    prepareHook: async callback => {
      onCall = callback;
      return { connect: () => fake.connection, close: async () => {} };
    },
  });
  const turn = execution.sendMessage(childWire, 'origin', 's', 'explore');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  const call: CodexHookCall = { session_id: 'child-1', turn_id: 'child-turn', tool_use_id: 'item-1',
    hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: process.cwd(), tool_input: { command: 'ls' } };
  expect(await onCall(call)).toBe('unknown-turn');
  const activity = { id: 'activity-1', type: 'subAgentActivity', kind: 'started',
    agentThreadId: 'child-1', agentPath: '/root/explorer' };
  fake.send({ method: 'item/completed', params: { threadId: 'other', turnId: 'turn-1', item: activity } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'other', item: activity } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
    item: { ...activity, agentPath: '/root' } } });
  await Bun.sleep(5);
  expect(await onCall(call)).toBe('unknown-turn');
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: activity } });
  fake.send({ method: 'turn/started', params: { threadId: 'child-1', turn: { id: 'child-turn' } } });
  fake.send({ id: 200, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'child-1', turnId: 'child-turn', itemId: 'before-hook',
    cwd: process.cwd(), command: 'cat .env',
  } });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const nativeAsk = messages.find(message => message.type === 'ask.request')!;
  expect(askTargetSessions.at(-1)).toBe('s');
  expect(nativeAsk.sessionId).toBe('s');
  const childId = messages.find(message => message.type === 'session.created')!.session.id;
  expect(nativeAsk.ask).toMatchObject({ allowedScopes: ['once'], _originSessionId: childId });
  expect(await codexApprovals.resolve(nativeAsk.toolCallId,
    { type: 'permission', grant: 'denied' }, nativeAsk.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(entry => entry.id === 200));
  expect(fake.sent.find(entry => entry.id === 200)?.result).toEqual({ decision: 'decline' });
  expect(await onCall(call)).toBe(true);
  expect(await onCall({ ...call, cwd: join(process.cwd(), 'src'),
    tool_input: { command: 'rg --files' } })).toBe(true);
  expect(await onCall({ ...call, session_id: 'unrelated' })).toBe('unknown-turn');
  expect(await onCall({ ...call, cwd: '/outside' })).toBe('working-directory');
  const sensitive = onCall({ ...call, tool_input: { command: 'cat .env' }, tool_use_id: 'sensitive' });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 2);
  const pendingAsk = messages.filter(message => message.type === 'ask.request')[1]!;
  expect(askTargetSessions.at(-1)).toBe('s');
  expect(pendingAsk.sessionId).toBe('s');
  expect(codexApprovals.getSessionId(pendingAsk.toolCallId, pendingAsk.requestId)).toBe('s');
  expect(pendingAsk.ask).toMatchObject({ _originSessionId: childId });
  expect(listPendingAsksBySession(childId).find(entry => entry.requestId === pendingAsk.requestId))
    .toMatchObject({ rootSessionId: 's', sessionId: childId });
  expect(listPendingRequestsByRootSession('s').some(entry => entry.requestId === pendingAsk.requestId))
    .toBe(true);
  expect(await codexApprovals.resolve(pendingAsk.toolCallId,
    { type: 'permission', grant: 'denied' }, pendingAsk.requestId)).toBe(true);
  expect(await sensitive).toBe('permission-denied');
  const permitted = onCall({ ...call, tool_input: { command: 'cat .env' }, tool_use_id: 'allowed' });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 3);
  const approvedAsk = messages.filter(message => message.type === 'ask.request')[2]!;
  expect(await codexApprovals.resolve(approvedAsk.toolCallId,
    { type: 'permission', grant: 'once' }, approvedAsk.requestId)).toBe(true);
  expect(await permitted).toBe(true);
  fake.send({ id: 201, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'child-1', turnId: 'child-turn', itemId: 'allowed', cwd: process.cwd(), command: 'cat .env',
  } });
  await waitFor(() => fake.sent.some(entry => entry.id === 201));
  expect(fake.sent.find(entry => entry.id === 201)?.result).toEqual({ decision: 'accept' });
  fake.send({ id: 203, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'child-1', turnId: 'child-turn', itemId: 'nested',
    cwd: join(process.cwd(), 'src'), command: 'rg --files',
  } });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 4);
  const nestedAsk = messages.filter(message => message.type === 'ask.request')[3]!;
  expect(nestedAsk.ask).toMatchObject({ allowedScopes: ['once'] });
  expect(await codexApprovals.resolve(nestedAsk.toolCallId,
    { type: 'permission', grant: 'session' }, nestedAsk.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(entry => entry.id === 203));
  expect(fake.sent.find(entry => entry.id === 203)?.result).toEqual({ decision: 'decline' });
  fake.send({ id: 202, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'unrelated', turnId: 'child-turn', itemId: 'allowed', cwd: process.cwd(), command: 'cat .env',
  } });
  await waitFor(() => fake.sent.some(entry => entry.id === 202));
  expect(fake.sent.find(entry => entry.id === 202)?.result).toEqual({ decision: 'decline' });
  fake.send({ method: 'thread/started', params: { thread: { id: 'child-2',
    source: { subAgent: { thread_spawn: { parentThreadId: 'other' } } } } } });
  fake.send({ method: 'thread/started', params: { thread: { id: 'child-3',
    source: { subAgent: { thread_spawn: { parentThreadId: 'thread-1' } } } } } });
  fake.send({ method: 'turn/started', params: { threadId: 'child-3', turn: { id: 'child-turn-3' } } });
  await Bun.sleep(5);
  expect(await onCall({ ...call, session_id: 'child-2' })).toBe('unknown-turn');
  expect(await onCall({ ...call, session_id: 'child-3', turn_id: 'child-turn-3' })).toBe(true);
  fake.send({ method: 'thread/started', params: { thread: { id: 'child-4',
    source: { subAgent: { thread_spawn: { parentThreadId: 'thread-1' } } } } } });
  fake.send({ method: 'turn/started', params: { threadId: 'child-4', turn: { id: 'child-turn' } } });
  await waitFor(() => messages.filter(message => message.type === 'session.created').length === 3);
  expect(await onCall({ ...call, session_id: 'thread-1' })).toBe('no-active-turn');
  fake.send({ method: 'thread/closed', params: { threadId: 'child-4' } });
  fake.send({ method: 'thread/closed', params: { threadId: 'child-3' } });
  await Bun.sleep(5);
  expect(await onCall({ ...call, session_id: 'child-3', turn_id: 'child-turn-3' })).toBe('unknown-turn');
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await turn;
  expect(await onCall({ ...call, session_id: 'thread-1', turn_id: 'turn-1' })).toBe('no-active-turn');
  expect(await onCall(call)).toBe(true);
  const aliased = { ...call, session_id: 'thread-1' };
  expect(await onCall(aliased)).toBe(true);
  const aliasedSensitive = onCall({ ...aliased, tool_use_id: 'aliased-sensitive',
    tool_input: { command: 'cat .env' } });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 5);
  const aliasedAsk = messages.filter(message => message.type === 'ask.request')[4]!;
  expect(aliasedAsk.sessionId).toBe('s');
  expect(await codexApprovals.resolve(aliasedAsk.toolCallId,
    { type: 'permission', grant: 'once' }, aliasedAsk.requestId)).toBe(true);
  expect(await aliasedSensitive).toBe(true);
  fake.send({ id: 204, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'child-turn', itemId: 'aliased-sensitive',
    cwd: process.cwd(), command: 'cat .env',
  } });
  await waitFor(() => fake.sent.some(entry => entry.id === 204));
  expect(fake.sent.find(entry => entry.id === 204)?.result).toEqual({ decision: 'accept' });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(5);
  const afterParent = onCall({ ...call, tool_use_id: 'after-parent', tool_input: { command: 'cat .env' } });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 6);
  const lateAsk = messages.filter(message => message.type === 'ask.request')[5]!;
  expect(lateAsk.sessionId).toBe('s');
  expect(codexApprovals.getSessionId(lateAsk.toolCallId, lateAsk.requestId)).toBe('s');
  expect(await codexApprovals.resolve(lateAsk.toolCallId,
    { type: 'permission', grant: 'once' }, lateAsk.requestId)).toBe(true);
  expect(await afterParent).toBe(true);
  fake.send({ method: 'turn/completed', params: { threadId: 'child-1', turn: { id: 'child-turn', status: 'completed' } } });
  await waitFor(() => !listMessagesWithParts(messages.find(message => message.type === 'session.created')!.session.id)
    .some(entry => entry.message.role === 'assistant' && entry.message.status === 'streaming'));
  expect(await onCall(call)).toBe('unknown-turn');
  expect(await onCall({ ...call, session_id: 'thread-1' })).toBe('no-active-turn');
});

test('Codex child timeline keeps receiving isolated events after parent completion', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, false, undefined, false, false, false, undefined, 'idle', true);
  const messages: ServerMessage[] = [];
  let connects = 0;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { connects++; return fake.connection; } });
  const parent = execution.sendMessage(wire(messages), 'origin', 's', 'delegate');
  await waitFor(() => fake.sent.some(entry => entry.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  // Codex can start a child turn before reporting the child's identity to its parent.
  fake.send({ method: 'turn/started', params: { threadId: 'child-1', turn: { id: 'child-turn' } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
    item: { id: 'spawn', type: 'subAgentActivity', kind: 'started', agentThreadId: 'child-1',
      agentPath: '/root/explorer' } } });
  await waitFor(() => messages.some(message => message.type === 'session.created'));
  const child = messages.find(message => message.type === 'session.created')!.session;
  expect(child).toMatchObject({ parentId: 's', harness: 'codex-cli', subagentStatus: 'running' });
  expect(getCodexBinding(child.id)?.threadId).toBe('child-1');
  expect(listMessagesWithParts(child.id).filter(entry => entry.message.role === 'assistant')).toHaveLength(1);
  const parentPart = listMessagesWithParts('s').at(-1)!.parts.find(part => part.type === 'tool');
  expect(parentPart?.state).toMatchObject({ childSessionId: child.id });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1',
    turn: { id: 'turn-1', status: 'completed' } } });
  await parent;
  expect(listMessagesWithParts('s').at(-1)!.parts.find(part => part.type === 'tool')?.state)
    .toMatchObject({ childSessionId: child.id });
  const projected = await projectMessagesForClient(listMessagesWithParts('s'));
  expect(projected.at(-1)!.parts.find(part => part.type === 'tool')?.state)
    .toMatchObject({ childSessionId: child.id });
  expect(connects).toBe(1);
  const followUp = execution.sendMessage(wire(messages), 'origin', 's', 'Continue');
  await waitFor(() => fake.sent.filter(entry => entry.method === 'turn/start').length === 2);
  expect(connects).toBe(1);
  expect(fake.sent.filter(entry => entry.method === 'thread/resume')).toHaveLength(0);
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  fake.send({ method: 'item/agentMessage/delta', params: { threadId: 'child-1', turnId: 'child-turn',
    itemId: 'reply', delta: 'Child result' } });
  fake.send({ method: 'item/completed', params: { threadId: 'child-1', turnId: 'child-turn',
    item: { id: 'reply', type: 'agentMessage', text: 'Child result' } } });
  fake.send({ method: 'turn/completed', params: { threadId: 'child-1',
    turn: { id: 'child-turn', status: 'completed' } } });
  await waitFor(() => getSession(child.id)?.subagentStatus === 'completed');
  expect(listMessagesWithParts(child.id).at(-1)?.parts).toMatchObject([{ type: 'text', text: 'Child result' }]);
  expect(listMessagesWithParts('s').some(entry => entry.parts.some(part => part.type === 'text'
    && part.text === 'Child result'))).toBe(false);
  expect(messages.filter(message => message.type === 'session.created')).toHaveLength(1);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1',
    turn: { id: 'turn-2', status: 'completed' } } });
  await followUp;
});

test('Codex child process loss marks its timeline as failed after the parent turn', async () => {
  create();
  const fake = fakeCodex();
  const messages: ServerMessage[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const parent = execution.sendMessage(wire(messages), 'origin', 's', 'delegate');
  await waitFor(() => fake.sent.some(entry => entry.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
    item: { id: 'spawn', type: 'subAgentActivity', kind: 'started', agentThreadId: 'child-1',
      agentPath: '/root/explorer' } } });
  fake.send({ method: 'turn/started', params: { threadId: 'child-1', turn: { id: 'child-turn' } } });
  await waitFor(() => messages.some(message => message.type === 'session.created'));
  const child = messages.find(message => message.type === 'session.created')!.session;
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1',
    turn: { id: 'turn-1', status: 'completed' } } });
  await parent;
  expect(execution.isSessionActive(child.id)).toBe(true);
  fake.connection.kill();
  await waitFor(() => getSession(child.id)?.subagentStatus === 'error');
  expect(execution.isSessionActive(child.id)).toBe(false);
  expect(listMessagesWithParts(child.id).at(-1)?.message).toMatchObject({ status: 'error' });
});

test('Stop after parent completion interrupts child turns on the same connection', async () => {
  create();
  const fake = fakeCodex();
  const messages: ServerMessage[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const parent = execution.sendMessage(wire(messages), 'origin', 's', 'delegate');
  await waitFor(() => fake.sent.some(entry => entry.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1',
    item: { id: 'spawn', type: 'subAgentActivity', kind: 'started', agentThreadId: 'child-1',
      agentPath: '/root/explorer' } } });
  fake.send({ method: 'turn/started', params: { threadId: 'child-1', turn: { id: 'child-turn' } } });
  await waitFor(() => messages.some(message => message.type === 'session.created'));
  const child = messages.find(message => message.type === 'session.created')!.session;
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1',
    turn: { id: 'turn-1', status: 'completed' } } });
  await parent;
  expect((await execution.interruptSession(child.id)).success).toBe(true);
  const stopped = await execution.interruptSession('s');
  expect(stopped.success).toBe(true);
  expect(stopped.cascadedTo).toContain(child.id);
  expect(fake.sent.find(entry => entry.method === 'turn/interrupt')?.params)
    .toEqual({ threadId: 'child-1', turnId: 'child-turn' });
  fake.send({ method: 'turn/completed', params: { threadId: 'child-1',
    turn: { id: 'child-turn', status: 'interrupted' } } });
  await waitFor(() => getSession(child.id)?.subagentStatus === 'interrupted');
});

test('native approval denials log fixed categories without request content', async () => {
  create();
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  const approvals = new CodexApprovals();
  const secret = 'private-command-value';
  const request = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
    cwd: process.cwd(), command: secret };
  try {
    const ask = (params: unknown) => approvals.request('item/commandExecution/requestApproval',
      params, 'thread-1', 'turn-1', 's', process.cwd(), 'ws', wire([]).delivery);
    expect(await ask({ ...request, cwd: '/other' })).toEqual({ decision: 'decline' });
    expect(await ask({ ...request, additionalPermissions: { sensitive: secret } }))
      .toEqual({ decision: 'decline' });
    expect(await ask({ ...request, itemId: '' })).toEqual({ decision: 'decline' });
    expect(warning.mock.calls.map(args => args.join(' '))).toEqual([
      '[codex-permission] native denied: working-directory',
      '[codex-permission] native denied: unsupported-permissions',
      '[codex-permission] native denied: malformed-request',
    ]);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('/other');
  } finally { warning.mockRestore(); }
});

test('Codex hook auto-approval follows the current session risk and remains once-only', async () => {
  create();
  const messages: ServerMessage[] = [];
  const approvals = new CodexApprovals(() => 1000);
  const delivery = wire(messages).delivery;
  const request = (risk: PermissionAsk['risk'], itemId: string) => approvals.requestHook({
    type: 'permission', question: 'Allow access?', resource: 'file', action: 'read',
    risk, allowedScopes: ['once'],
  }, 'Bash', 'cat .env', itemId, 'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  const missing = request('low', 'missing-setting');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  approvals.cancelSession('s');
  expect(await missing).toBe(false);
  updateSession('s', { autoApproveSeverity: 'low' });
  const low = await request('low', 'item-1');
  expect(low).toBe(true);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  const native = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'cat .env', cwd: process.cwd() };
  expect(await approvals.request('item/commandExecution/requestApproval', native,
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery)).toEqual({ decision: 'accept' });
  const repeat = request('medium', 'item-2');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(2);
  approvals.cancelSession('s');
  expect(await repeat).toBe(false);

  updateSession('s', { autoApproveSeverity: 'high' });
  expect(await request('high', 'item-3')).toBe(true);
  const nativeCritical = approvals.request('item/commandExecution/requestApproval', { ...native, itemId: 'other' },
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(3);
  approvals.cancelSession('s');
  expect(await nativeCritical).toEqual({ decision: 'decline' });
  updateSession('s', { autoApproveSeverity: 'off' });
  const disabled = request('none', 'item-4');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(4);
  approvals.cancelSession('s');
  expect(await disabled).toBe(false);
  updateSession('s', { autoApproveSeverity: 'high' });
  const critical = request('critical', 'item-5');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(5);
  approvals.cancelSession('s');
  expect(await critical).toBe(false);
});

test('Codex dynamic tool asks honor the current session ceiling and keep manual fallback once-only', async () => {
  create();
  const messages: ServerMessage[] = [];
  const approvals = new CodexApprovals(() => 1000);
  const delivery = wire(messages).delivery;
  const request = (tool: 'memory' | 'session_search', risk: PermissionAsk['risk'], workspaceId = 'ws') => {
    const ask: PermissionAsk = { type: 'permission', question: 'Allow?',
      resource: tool === 'memory' ? 'file' : 'session', action: tool === 'memory' ? 'write' : 'read', risk };
    return tool === 'memory' ? approvals.requestMemory(ask, 's', workspaceId, delivery)
      : approvals.requestSessionSearch(ask, 's', workspaceId, delivery);
  };
  expect(await request('session_search', 'low', 'other')).toBe(false);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(0);
  const unset = request('memory', 'low');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  approvals.cancelSession('s');
  expect(await unset).toBe(false);
  messages.length = 0;
  updateSession('s', { autoApproveSeverity: 'low' });
  expect(await request('session_search', 'low')).toBe(true);
  expect(await request('memory', 'none')).toBe(true);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(0);
  const above = request('session_search', 'medium');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  approvals.cancelSession('s');
  expect(await above).toBe(false);
  updateSession('s', { autoApproveSeverity: 'high' });
  expect(await request('memory', 'high')).toBe(true);
  expect(await request('session_search', 'medium')).toBe(true);
  const critical = request('memory', 'critical');
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(2);
  approvals.cancelSession('s');
  expect(await critical).toBe(false);
  const unknown = request('session_search', undefined);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(3);
  approvals.cancelSession('s');
  expect(await unknown).toBe(false);
  updateSession('s', { autoApproveSeverity: 'off' });
  const off = request('session_search', 'low');
  const lastAsk = messages.filter(message => message.type === 'ask.request').at(-1)!;
  expect(lastAsk).toMatchObject({ toolName: 'codex-cli:session_search', ask: { allowedScopes: ['once'] } });
  expect(await approvals.resolve(lastAsk.toolCallId,
    { type: 'permission', grant: 'workspace' }, lastAsk.requestId)).toBe(true);
  expect(await off).toBe(false);
  const manual = request('memory', 'low');
  const memoryAsk = messages.filter(message => message.type === 'ask.request').at(-1)!;
  expect(memoryAsk).toMatchObject({ toolName: 'codex-cli:memory', ask: { allowedScopes: ['once'] } });
  expect(await approvals.resolve(memoryAsk.toolCallId,
    { type: 'permission', grant: 'once' }, memoryAsk.requestId)).toBe(true);
  expect(await manual).toBe(true);
});

test('Codex risk auto-approval rejects missing, unknown and critical risks', () => {
  const ask = (risk?: PermissionAsk['risk']): PermissionAsk => ({
    type: 'permission', question: 'Allow?', resource: 'file', action: 'read', risk,
  });
  expect(canAutoApproveCodexHook(ask('none'), 'none')).toBe(true);
  expect(canAutoApproveCodexHook(ask('medium'), 'low')).toBe(false);
  expect(canAutoApproveCodexHook(ask('critical'), 'high')).toBe(false);
  expect(canAutoApproveCodexHook(ask(undefined), 'high')).toBe(false);
  expect(canAutoApproveCodexHook(ask('unrecognized' as PermissionAsk['risk']), 'high')).toBe(false);
  expect(canAutoApproveCodexHook(ask('low'), 'off')).toBe(false);
  expect(canAutoApproveCodexHook(ask('low'), undefined)).toBe(false);
  expect(canAutoApproveCodexHook(ask('low'), 'unknown')).toBe(false);
});

test('hook ask timeout and interruption deny and expire pending requests', async () => {
  create();
  const messages: ServerMessage[] = [];
  const approvals = new CodexApprovals(() => 5);
  const delivery = wire(messages).delivery;
  const ask: PermissionAsk = { type: 'permission', question: 'Allow deletion?', resource: 'file', action: 'delete',
    risk: 'high', allowedScopes: ['once'] };
  const expired = approvals.requestHook(ask, 'Bash', 'rm file', 'item-1',
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  expect(await expired).toBe(false);
  const first = messages.find(message => message.type === 'ask.request')!;
  expect(getPermissionRequestByRequestId(first.requestId!)?.status).toBe('expired');
  expect(await approvals.resolve(first.toolCallId, { type: 'permission', grant: 'once' }, first.requestId)).toBe(false);
  const interrupted = approvals.requestHook(ask, 'Bash', 'rm file', 'item-2',
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  approvals.cancelSession('s');
  expect(await interrupted).toBe(false);
  expect(messages.filter(message => message.type === 'ask.timeout')).toHaveLength(2);
});

test('hook approval suppresses only a matching native command prompt for that turn', async () => {
  create();
  const messages: ServerMessage[] = [];
  const approvals = new CodexApprovals(() => 1000);
  const delivery = wire(messages).delivery;
  const command = 'rm -rf ./generated';
  const pending = approvals.requestHook({ type: 'permission', question: 'Allow deletion?',
    resource: 'shell-command', action: 'execute', risk: 'high', allowedScopes: ['once'] },
  'Bash', command, 'item-1', 'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  const ask = messages.find(message => message.type === 'ask.request')!;
  expect(await approvals.resolve(ask.toolCallId, { type: 'permission', grant: 'once' }, ask.requestId)).toBe(true);
  expect(await pending).toBe(true);
  const params = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command, cwd: process.cwd() };
  expect(await approvals.request('item/commandExecution/requestApproval', params,
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery)).toEqual({ decision: 'accept' });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  const next = approvals.request('item/commandExecution/requestApproval', { ...params, itemId: 'item-2' },
    'thread-1', 'turn-1', 's', process.cwd(), 'ws', delivery);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(2);
  approvals.cancelSession('s');
  expect(await next).toEqual({ decision: 'decline' });
});

test('Codex malformed requests decline and interrupted file approvals cannot be reused', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const turn = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ id: 70, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'other', turnId: 'turn-1', itemId: 'item', command: 'rm -rf .', cwd: process.cwd(),
  } });
  await waitFor(() => fake.sent.some(message => message.id === 70));
  expect(fake.sent.find(message => message.id === 70)?.result).toEqual({ decision: 'decline' });
  fake.send({ id: 71, method: 'item/fileChange/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-1', reason: 'edit files',
  } });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const ask = messages.find(message => message.type === 'ask.request')!;
  expect(ask.ask).toMatchObject({ allowedScopes: ['once'] });
  expect(await codexApprovals.resolve(ask.toolCallId, { type: 'permission', grant: 'workspace' }, ask.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 71));
  expect(fake.sent.find(message => message.id === 71)?.result).toEqual({ decision: 'decline' });
  fake.send({ id: 72, method: 'item/fileChange/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'file-2',
  } });
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 2);
  const pending = messages.filter(message => message.type === 'ask.request')[1]!;
  await execution.interruptSession('s');
  await waitFor(() => fake.sent.some(message => message.id === 72));
  expect(fake.sent.find(message => message.id === 72)?.result).toEqual({ decision: 'decline' });
  expect(await codexApprovals.resolve(pending.toolCallId, { type: 'permission', grant: 'once' }, pending.requestId)).toBe(false);
  expect(listPendingAsksBySession('s').find(record => record.requestId === pending.requestId)?.status).toBe('expired');
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  await turn;
});

test('grant persistence failure declines and rolls back the approval', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const turn = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ id: 91, method: 'item/commandExecution/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', command: 'git status', cwd: process.cwd(),
  } });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const ask = messages.find(message => message.type === 'ask.request')!;
  getDatabase().run(`CREATE TRIGGER reject_codex_grant BEFORE INSERT ON permission_grants
    WHEN NEW.tool_name = 'codex-cli:command' BEGIN SELECT RAISE(FAIL, 'test failure'); END`);
  expect(await codexApprovals.resolve(ask.toolCallId, { type: 'permission', grant: 'workspace' }, ask.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 91));
  expect(fake.sent.find(message => message.id === 91)?.result).toEqual({ decision: 'decline' });
  expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('denied');
  expect(getDatabase().query("SELECT COUNT(*) AS count FROM permission_grants WHERE tool_name = 'codex-cli:command'")
    .get()).toEqual({ count: 0 });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await turn;
});

test('delivery failure expires a Codex approval and declines without leaving a waiter', async () => {
  create();
  const messages: ServerMessage[] = [];
  const delivery = wire(messages).delivery;
  const result = await codexApprovals.request('item/fileChange/requestApproval', {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
  }, 'thread-1', 'turn-1', 's', process.cwd(), 'ws', {
    ...delivery,
    sendToAskTargets: () => { throw new Error('delivery unavailable'); },
  });
  expect(result).toEqual({ decision: 'decline' });
  const record = listPendingAsksBySession('s')[0]!;
  expect(record.status).toBe('expired');
  expect(codexApprovals.hasLiveRequest(record.requestId)).toBe(false);
});

test('Codex approval timeout declines and removes its live request', async () => {
  create();
  const messages: ServerMessage[] = [];
  const approvals = new CodexApprovals(() => 5);
  const pending = approvals.request('item/fileChange/requestApproval', {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
  }, 'thread-1', 'turn-1', 's', process.cwd(), 'ws', wire(messages).delivery);
  expect(await pending).toEqual({ decision: 'decline' });
  const ask = messages.find(message => message.type === 'ask.request')!;
  expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('expired');
  expect(approvals.hasLiveRequest(ask.requestId!)).toBe(false);
  expect(messages.some(message => message.type === 'ask.timeout')).toBe(true);
});

test('a lost Codex process expires an outstanding approval and rejects stale replies', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const turn = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ id: 92, method: 'item/fileChange/requestApproval', params: {
    threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
  } });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const ask = messages.find(message => message.type === 'ask.request')!;
  fake.connection.kill();
  await turn;
  expect(codexApprovals.hasLiveRequest(ask.requestId!)).toBe(false);
  expect(getPermissionRequestByRequestId(ask.requestId!)?.status).toBe('expired');
  expect(await codexApprovals.resolve(ask.toolCallId, { type: 'permission', grant: 'once' }, ask.requestId)).toBe(false);
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

test('Codex rejects malformed budgets and mismatched objectives before starting', async () => {
  create();
  const messages: ServerMessage[] = [];
  const execution = createCodexExecution({ version: () => { throw new Error('must not start'); },
    connect: () => { throw new Error('must not connect'); } });
  for (const [objective, budget] of [['Ship it', 0], ['Ship it', 1.5],
    ['Ship it', 1_000_001], ['different', 50000], [null, 50000]] as const) {
    await execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
      objective as string | undefined, undefined, budget);
    expect(messages.at(-1)).toMatchObject({ type: 'error', code: 'invalid_session' });
  }
  expect(listMessagesWithParts('s')).toHaveLength(0);
});

test('Codex starts the user turn before activating a native goal', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  expect(fake.sent.some(message => message.method === 'thread/goal/set')).toBe(false);
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => fake.sent.some(message => message.method === 'thread/goal/set'));
  expect(fake.sent.filter(message => message.method === 'turn/start')).toHaveLength(1);
  expect(fake.sent.find(message => message.method === 'thread/goal/set')?.params).toEqual({
    threadId: 'thread-1', objective: 'Ship it', status: 'active', tokenBudget: 50000,
  });
  fake.send({ method: 'thread/goal/updated', params: { threadId: 'thread-1', turnId: 'turn-1', goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'complete', tokenBudget: 50000,
    tokensUsed: 120, timeUsedSeconds: 1, createdAt: 1, updatedAt: 2,
  } } });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await send;
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'complete', tokensUsed: 120 } });
});

test('native goal continuations stay in one process and create separate assistant messages', async () => {
  create();
  const fake = fakeCodex();
  let launches = 0;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { launches++; return fake.connection; } });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => fake.sent.some(message => message.method === 'thread/goal/set'));
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await waitFor(() => {
    const message = listMessagesWithParts('s')[1]?.message;
    return message?.role === 'assistant' && message.status === 'completed';
  });
  expect(execution.isSessionActive('s')).toBe(true);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  fake.send({ method: 'item/agentMessage/delta', params: {
    threadId: 'thread-1', turnId: 'turn-2', itemId: 'a2', delta: 'Continued',
  } });
  fake.send({ method: 'thread/goal/updated', params: { threadId: 'thread-1', turnId: 'turn-2', goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'budgetLimited', tokenBudget: 50000,
    tokensUsed: 50000, timeUsedSeconds: 5, createdAt: 1, updatedAt: 2,
  } } });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed' } } });
  await send;
  expect(launches).toBe(1);
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'budgetLimited' } });
  expect(listMessagesWithParts('s').map(entry => entry.message.role)).toEqual(['user', 'assistant', 'assistant']);
  expect(listMessagesWithParts('s')[2]?.parts).toMatchObject([{ type: 'text', text: 'Continued' }]);
});

test('Stop before turn/start response does not activate the goal', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, false, undefined, false, true);
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  const request = fake.sent.find(message => message.method === 'turn/start')!;
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getCodexBinding('s')?.pendingTurnId === 'turn-1');
  const stop = execution.interruptSession('s');
  fake.send({ id: request.id, result: { turn: { id: 'turn-1' } } });
  await stop;
  expect(fake.sent.some(message => message.method === 'thread/goal/set')).toBe(false);
  expect(fake.sent.some(message => message.method === 'turn/interrupt')).toBe(true);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  await send;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('Stop waits for in-flight goal activation before pausing and interrupting', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, false, undefined, true);
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => fake.sent.some(message => message.method === 'thread/goal/set'));
  const activation = fake.sent.find(message => message.method === 'thread/goal/set')!;
  const stop = execution.interruptSession('s');
  await Bun.sleep(5);
  expect(fake.sent.filter(message => message.method === 'thread/goal/set')).toHaveLength(1);
  fake.send({ id: activation.id, result: { goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'active', tokenBudget: 50000,
    tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
  } } });
  await stop;
  expect(fake.sent.map(message => message.method).filter(method => method === 'thread/goal/set' || method === 'turn/interrupt'))
    .toEqual(['thread/goal/set', 'thread/goal/set', 'turn/interrupt']);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'paused' } });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  await send;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('Stop between goal turns pauses without interrupting the completed turn', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null && fake.sent.some(message => message.method === 'thread/goal/set'));
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await waitFor(() => {
    const message = listMessagesWithParts('s')[1]?.message;
    return message?.role === 'assistant' && message.status === 'completed';
  });
  expect(execution.isSessionActive('s')).toBe(true);
  expect((await execution.interruptSession('s')).success).toBe(true);
  await send;
  expect(fake.sent.filter(message => message.method === 'turn/interrupt')).toHaveLength(0);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'paused' } });
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('interrupt pauses a native goal before interrupting its current turn', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null && fake.sent.some(message => message.method === 'thread/goal/set'));
  await execution.interruptSession('s');
  expect(fake.sent.map(message => message.method).filter(method => method === 'thread/goal/set' || method === 'turn/interrupt'))
    .toEqual(['thread/goal/set', 'thread/goal/set', 'turn/interrupt']);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'paused' } });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  await send;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('goal activation response after turn completion still bounds continuation wait', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, false, undefined, true);
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => fake.connection, goalIdleTimeoutMs: 15 });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => fake.sent.some(message => message.method === 'thread/goal/set'));
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  const request = fake.sent.find(message => message.method === 'thread/goal/set')!;
  fake.send({ id: request.id, result: { goal: { threadId: 'thread-1', objective: 'Ship it',
    status: 'active', tokenBudget: 50000, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1 } } });
  await send;
  expect(messages.some(message => message.type === 'error')).toBe(true);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
});

test('stalled active goal reports an error and keeps recovery pending', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => fake.connection, goalIdleTimeoutMs: 15 });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await send;
  expect(messages.some(message => message.type === 'error')).toBe(true);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'active' } });
});

test('late active goal update and continuation after Stop stay unresolved', async () => {
  create();
  const fake = fakeCodex(undefined, undefined, false, undefined, false, false, true);
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await waitFor(() => {
    const message = listMessagesWithParts('s')[1]?.message;
    return message?.role === 'assistant' && message.status === 'completed';
  });
  const stop = execution.interruptSession('s');
  await waitFor(() => fake.sent.filter(message => message.method === 'thread/goal/set').length === 2);
  const pause = fake.sent.filter(message => message.method === 'thread/goal/set')[1]!;
  fake.send({ id: pause.id, result: { goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'paused', tokenBudget: 50000,
    tokensUsed: 1, timeUsedSeconds: 1, createdAt: 1, updatedAt: 3,
  } } });
  fake.send({ method: 'thread/goal/updated', params: { threadId: 'thread-1', turnId: 'turn-1', goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'active', tokenBudget: 50000,
    tokensUsed: 1, timeUsedSeconds: 1, createdAt: 1, updatedAt: 2,
  } } });
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  await stop;
  await send;
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'paused' } });
  expect(getCodexBinding('s')?.goalRequested).toBe(true);
  expect(listMessagesWithParts('s')).toHaveLength(2);
  const next = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { throw new Error('must not connect'); } });
  await next.sendMessage(wire(messages), 'origin', 's', 'Again');
  expect(listMessagesWithParts('s')).toHaveLength(2);
});

test('process loss during a goal continuation cannot replay or accept a new user turn', async () => {
  create();
  const processes: ReturnType<typeof fakeCodex>[] = [];
  let userId: string | null = null;
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [
      { id: 'turn-1', status: 'completed', itemsView: 'full', items: [
        { type: 'userMessage', clientId: userId }, { type: 'agentMessage', text: 'First' },
      ] },
      { id: 'turn-2', status: 'completed', itemsView: 'full', items: [{ type: 'agentMessage', text: 'Second' }] },
    ] }));
    processes.push(fake); return fake.connection;
  } };
  const messages: ServerMessage[] = [];
  const first = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Ship it',
    undefined, undefined, 'Ship it', undefined, 50000);
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  userId = (processes[0]!.sent.find(message => message.method === 'turn/start')!.params as { clientUserMessageId: string }).clientUserMessageId;
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null);
  processes[0]!.send({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' },
  } });
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  await waitFor(() => listMessagesWithParts('s').length === 3);
  processes[0]!.connection.kill();
  await first;
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  expect(listMessagesWithParts('s')[1]?.message).toMatchObject({ status: 'completed' });
  const count = listMessagesWithParts('s').length;
  await createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'again');
  expect(listMessagesWithParts('s')).toHaveLength(count);
  expect(processes).toHaveLength(2);
  expect(processes[1]!.sent.map(message => message.method)).toContain('thread/goal/get');
  expect(processes[1]!.sent.some(message => message.method === 'turn/start')).toBe(false);
});

test('lost goal activation stays pending even if the original turn ended', async () => {
  create();
  let userId: string | null = null;
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [{
      id: 'turn-1', status: 'completed', itemsView: 'full', items: [{ type: 'userMessage', clientId: userId }],
    }] }), processes.length === 0 ? 'thread/goal/set' : undefined);
    processes.push(fake); return fake.connection;
  } };
  const messages: ServerMessage[] = [];
  const first = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Ship it',
    undefined, undefined, 'Ship it', undefined, 50000);
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  userId = (processes[0]!.sent.find(message => message.method === 'turn/start')!.params as { clientUserMessageId: string }).clientUserMessageId;
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await first;
  expect(getCodexBinding('s')).toMatchObject({ pendingTurn: true, goalRequested: true });
  await createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Again');
  expect(processes[1]!.sent.some(message => message.method === 'turn/start')).toBe(false);
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  expect(listMessagesWithParts('s')).toHaveLength(2);
});

test('lost activation with no upstream goal reconciles only the original terminal turn', async () => {
  create();
  let userId: string | null = null;
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [{
      id: 'turn-1', status: 'completed', itemsView: 'full', items: [
        { type: 'userMessage', clientId: userId }, { type: 'agentMessage', text: 'Recovered' },
      ],
    }] }), processes.length === 0 ? 'thread/goal/set' : undefined, false, () => null);
    processes.push(fake); return fake.connection;
  } };
  const messages: ServerMessage[] = [];
  const first = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Ship it',
    undefined, undefined, 'Ship it', undefined, 50000);
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  userId = (processes[0]!.sent.find(message => message.method === 'turn/start')!.params as { clientUserMessageId: string }).clientUserMessageId;
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await first;
  expect(getCodexBinding('s')?.goalRequested).toBe(true);
  const next = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Next');
  await waitFor(() => processes[2]?.sent.some(message => message.method === 'turn/start') ?? false);
  expect(processes[1]!.sent.some(message => message.method === 'thread/goal/get')).toBe(true);
  expect(listMessagesWithParts('s')[1]?.parts).toMatchObject([{ type: 'text', text: 'Recovered' }]);
  expect(getSession('s')?.metadata).not.toHaveProperty('codexGoalPending');
  processes[2]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  processes[2]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await next;
});

test('restart reconciles the exact terminal goal continuation without replaying it', async () => {
  create();
  let userId: string | null = null;
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const deps = { version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: [
      { id: 'turn-1', status: 'completed', itemsView: 'full', items: [
        { type: 'userMessage', clientId: userId }, { type: 'agentMessage', text: 'First' },
      ] },
      { id: 'turn-2', status: 'completed', itemsView: 'full', items: [{ type: 'agentMessage', text: 'Recovered' }] },
    ] }), undefined, false, () => ({ threadId: 'thread-1', objective: 'Ship it', status: 'complete',
      tokenBudget: 50000, tokensUsed: 650, timeUsedSeconds: 2, createdAt: 1, updatedAt: 2 }));
    processes.push(fake); return fake.connection;
  } };
  const messages: ServerMessage[] = [];
  const first = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Ship it',
    undefined, undefined, 'Ship it', undefined, 50000);
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  userId = (processes[0]!.sent.find(message => message.method === 'turn/start')!.params as { clientUserMessageId: string }).clientUserMessageId;
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null);
  processes[0]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  processes[0]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  await waitFor(() => getCodexBinding('s')?.pendingTurnId === 'turn-2');
  processes[0]!.connection.kill();
  await first;
  const next = createCodexExecution(deps).sendMessage(wire(messages), 'origin', 's', 'Next');
  await waitFor(() => processes[2]?.sent.some(message => message.method === 'turn/start') ?? false);
  expect(processes[1]!.sent.map(message => message.method)).toEqual([
    'initialize', 'initialized', 'thread/read', 'thread/goal/get',
  ]);
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: { status: 'complete', tokensUsed: 650 } });
  expect(listMessagesWithParts('s')[2]?.parts).toMatchObject([{ type: 'text', text: 'Recovered' }]);
  expect(listMessagesWithParts('s')[2]?.message).toMatchObject({ status: 'completed' });
  processes[2]!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  processes[2]!.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await next;
  expect(getCodexBinding('s')?.pendingTurn).toBe(false);
});

test('an unexpected goal clear fails closed without claiming completion', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const send = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined, undefined,
    'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => getSession('s')?.metadata !== null);
  fake.send({ method: 'thread/goal/cleared', params: { threadId: 'thread-1' } });
  await send;
  expect(getSession('s')?.metadata).toMatchObject({ codexGoal: null });
  expect(getCodexBinding('s')?.pendingTurn).toBe(true);
  expect(messages.some(message => message.type === 'error')).toBe(true);
});

test('legacy Codex session picks the workspace default before starting its thread', async () => {
  create();
  updateSession('s', { preconfigId: null });
  updateWorkspace('ws', { settings: { preconfigs: { selectedIds: ['other'], defaultId: 'other' } } });
  const preconfigs = ['test', 'other'].map(id => ({ id, mode: 'primary', systemPrompt: `${id} instruction`,
    model: 'prokop-model' } as import('@prokopai/sdk').Preconfig));
  const fake = fakeCodex();
  const events: ServerMessage[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection,
    instructions: {
      listPreconfigs: async () => preconfigs,
      getPreconfig: async id => preconfigs.find(item => item.id === id) ?? null,
      getAgentDirectory: async () => null,
      readAgentMemoryFile: async () => null,
    } });
  const pending = execution.sendMessage(wire(events), 'origin', 's', 'hello');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  expect(getSession('s')?.preconfigId).toBe('other');
  expect((fake.sent.find(message => message.method === 'thread/start')?.params as Record<string, unknown>)
    .developerInstructions).toContain('other instruction');
  expect((fake.sent.find(message => message.method === 'turn/start')?.params as Record<string, unknown>)
    .model).toBeUndefined();
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await pending;
});

test('Codex refuses missing or deleted preconfigs before starting a turn', async () => {
  create();
  const messages: ServerMessage[] = [];
  let launches = 0;
  const sources = {
    listPreconfigs: async () => [],
    getPreconfig: async () => null,
    getAgentDirectory: async () => null,
    readAgentMemoryFile: async () => null,
  };
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { launches++; return fakeCodex().connection; }, instructions: sources });
  await execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  expect(launches).toBe(0);
  expect(listMessagesWithParts('s')).toHaveLength(0);
  expect(messages.at(-1)).toMatchObject({ type: 'error', code: 'invalid_session' });
  updateSession('s', { preconfigId: null });
  await execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  expect(launches).toBe(0);
  expect(listMessagesWithParts('s')).toHaveLength(0);
});

test('Codex usage accepts only active matching turns, including goal continuations', async () => {
  create();
  const fake = fakeCodex();
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => fake.connection });
  const messages: ServerMessage[] = [];
  const pending = execution.sendMessage(wire(messages), 'origin', 's', 'Ship it', undefined,
    undefined, 'Ship it', undefined, 50000);
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  const usage = { last: { totalTokens: 1000, inputTokens: 800, cachedInputTokens: 100,
    cacheWriteInputTokens: 0, outputTokens: 200, reasoningOutputTokens: 50 },
  total: { totalTokens: 3000, inputTokens: 2400, cachedInputTokens: 300,
    cacheWriteInputTokens: 0, outputTokens: 600, reasoningOutputTokens: 100 },
  modelContextWindow: 10000 };
  const notify = (threadId: string, turnId: string, tokenUsage: unknown) => fake.send({
    method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage },
  });
  notify('other', 'turn-1', usage);
  notify('thread-1', 'other', usage);
  notify('thread-1', 'turn-1', { ...usage, modelContextWindow: 'invalid' });
  await Bun.sleep(5);
  expect(getSession('s')?.metadata?.codexUsage).toBeUndefined();
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  await waitFor(() => fake.sent.some(message => message.method === 'thread/goal/set'));
  notify('thread-1', 'turn-1', usage);
  await waitFor(() => getSession('s')?.metadata?.codexUsage !== undefined);
  expect(getSession('s')?.metadata?.codexUsage).toEqual(usage);
  expect(messages.some(message => message.type === 'session.updated'
    && (message.session.metadata?.codexUsage as { last?: { totalTokens: number } } | undefined)?.last?.totalTokens === 1000)).toBe(true);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  notify('thread-1', 'turn-1', { ...usage, modelContextWindow: 1 });
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  await waitFor(() => getCodexBinding('s')?.pendingTurnId === 'turn-2');
  notify('thread-1', 'turn-1', { ...usage, modelContextWindow: 2 });
  notify('thread-1', 'turn-2', { ...usage, modelContextWindow: null });
  await waitFor(() => (getSession('s')?.metadata?.codexUsage as { modelContextWindow: number | null })?.modelContextWindow === null);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed' } } });
  fake.send({ method: 'thread/goal/updated', params: { threadId: 'thread-1', goal: {
    threadId: 'thread-1', objective: 'Ship it', status: 'complete', tokenBudget: 50000,
    tokensUsed: 3000, timeUsedSeconds: 3, createdAt: 1, updatedAt: 2,
  } } });
  await pending;
  expect((getSession('s')?.metadata?.codexUsage as { modelContextWindow: number | null }).modelContextWindow).toBeNull();
});

test('Codex advertises only memory tools and handles calls on start and resume', async () => {
  create();
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'none' } } });
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const calls: Array<{ directory: string; input: Record<string, unknown> }> = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { const fake = fakeCodex(); processes.push(fake); return fake.connection; },
    memoryTools: {
      definitions: () => ['memory', 'agent_memory', 'shell'].map(name => ({
        type: 'function', name, description: name, inputSchema: { type: 'object' },
      })),
      execute: async (input, directory) => {
        calls.push({ input, directory }); return { success: true, result: { action: input.action } };
      },
    },
  });
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'hello');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const initial = processes[0]!;
  expect(initial.sent.find(message => message.method === 'initialize')?.params).toMatchObject({
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  const threadStart = initial.sent.find(message => message.method === 'thread/start')?.params as Record<string, unknown>;
  expect(threadStart.dynamicTools).toMatchObject([{ name: 'memory' }]);
  expect(threadStart.developerInstructions).toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(threadStart.developerInstructions).not.toContain('Use "agent_memory" (personal)');
  const sendCall = (fake: ReturnType<typeof fakeCodex>, id: number, turnId: string, tool = 'memory') => fake.send({
    id, method: 'item/tool/call', params: { threadId: 'thread-1', turnId,
      callId: `call-${id}`, namespace: null, tool, arguments: { action: 'list', target: 'memory' } },
  });
  sendCall(initial, 20, 'wrong');
  initial.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  sendCall(initial, 21, 'turn-1');
  sendCall(initial, 22, 'turn-1', 'shell');
  await waitFor(() => initial.sent.some(message => message.id === 22));
  expect(initial.sent.filter(message => [20, 21, 22].includes(message.id as number))
    .map(message => [message.id, (message.result as { success: boolean }).success]))
    .toEqual([[20, false], [21, true], [22, false]]);
  expect(calls).toHaveLength(1);
  initial.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await first;
  const second = execution.sendMessage(wire(messages), 'origin', 's', 'again');
  await waitFor(() => processes[1]?.sent.some(message => message.method === 'turn/start') ?? false);
  const resumed = processes[1]!;
  expect(resumed.sent.find(message => message.method === 'thread/resume')?.params).not.toHaveProperty('dynamicTools');
  resumed.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  sendCall(resumed, 23, 'turn-1');
  await waitFor(() => resumed.sent.some(message => message.id === 23));
  expect(resumed.sent.find(message => message.id === 23)?.result).toMatchObject({ success: true });
  expect(calls).toHaveLength(2);
  resumed.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await second;
});

test('Codex workspace memory write asks the controller once and rejects broader grants', async () => {
  create();
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'high' } } });
  const fake = fakeCodex();
  let writes = 0;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => fake.connection,
    memoryTools: { definitions: () => [{ type: 'function', name: 'memory', description: 'Memory',
      inputSchema: { type: 'object' } }],
    execute: async (_input, _directory, risk, ask) => {
      if (risk !== 'high' || !ask || !await ask({ type: 'permission', question: 'Allow memory write?',
        description: 'Memory write', risk, resource: 'file', action: 'write', paths: ['MEMORY.md'] })) {
        return { success: false, error: 'USER_REJECTION' };
      }
      writes++;
      return { success: true, result: { action: 'add' } };
    } },
  });
  const messages: ServerMessage[] = [];
  const pending = execution.sendMessage(wire(messages), 'origin', 's', 'remember this');
  await waitFor(() => fake.sent.some(message => message.method === 'turn/start'));
  fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  const sendCall = (id: number) => fake.send({ id, method: 'item/tool/call', params: {
    threadId: 'thread-1', turnId: 'turn-1', callId: `call-${id}`, namespace: null,
    tool: 'memory', arguments: { action: 'add', target: 'memory', content: 'fact' },
  } });
  sendCall(40);
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const firstAsk = messages.find(message => message.type === 'ask.request')!;
  expect(firstAsk.ask).toMatchObject({ risk: 'high', allowedScopes: ['once'] });
  expect(await codexApprovals.resolve(firstAsk.toolCallId,
    { type: 'permission', grant: 'workspace' }, firstAsk.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 40));
  expect(fake.sent.find(message => message.id === 40)?.result).toMatchObject({ success: false });
  sendCall(41);
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 2);
  const secondAsk = messages.filter(message => message.type === 'ask.request')[1]!;
  expect(await codexApprovals.resolve(secondAsk.toolCallId,
    { type: 'permission', grant: 'once' }, secondAsk.requestId)).toBe(true);
  await waitFor(() => fake.sent.some(message => message.id === 41));
  expect(fake.sent.find(message => message.id === 41)?.result).toMatchObject({ success: true });
  expect(writes).toBe(1);
  updateSession('s', { autoApproveSeverity: 'high' });
  sendCall(42);
  await waitFor(() => fake.sent.some(message => message.id === 42));
  expect(fake.sent.find(message => message.id === 42)?.result).toMatchObject({ success: true });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(2);
  expect(writes).toBe(2);
  fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await pending;
});

test('Codex advertises session search, routes approved reads, and handles resume calls', async () => {
  create();
  updateWorkspace('ws', { settings: { sessionSearch: {
    enabled: true, permissionRisk: 'high', includeToolResults: true,
  } } });
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const calls: Array<{ input: Record<string, unknown>; includeTools: boolean; risk: string }> = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { const fake = fakeCodex(); processes.push(fake); return fake.connection; },
    sessionSearch: { definitions: () => [{ type: 'function', name: 'session_search',
      description: 'Search sessions', inputSchema: { type: 'object' } }],
    execute: async (input, _workspace, _session, includeTools, risk, ask) => {
      calls.push({ input, includeTools, risk });
      if (input.action !== 'list' && !await ask({ type: 'permission', resource: 'session', action: 'read',
        risk, question: 'Read?', description: 'Search sessions' })) return { success: false, error: 'USER_REJECTION' };
      return { success: true, mode: input.action === 'list' ? 'list' : 'search', sessions: [] };
    } },
  });
  const messages: ServerMessage[] = [];
  const first = execution.sendMessage(wire(messages), 'origin', 's', 'find it');
  await waitFor(() => processes[0]?.sent.some(message => message.method === 'turn/start') ?? false);
  const initial = processes[0]!;
  expect(initial.sent.find(message => message.method === 'thread/start')?.params).toMatchObject({
    dynamicTools: [{ name: 'session_search' }],
  });
  expect((initial.sent.find(message => message.method === 'thread/start')?.params as {
    developerInstructions: string }).developerInstructions).toContain('Use session_search to recall past conversations');
  initial.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  const sendCall = (fake: ReturnType<typeof fakeCodex>, id: number, args: Record<string, unknown>) => fake.send({
    id, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1',
      callId: `call-${id}`, namespace: null, tool: 'session_search', arguments: args },
  });
  sendCall(initial, 90, { action: 'list' });
  await waitFor(() => initial.sent.some(message => message.id === 90));
  expect(initial.sent.find(message => message.id === 90)?.result).toMatchObject({ success: true });
  expect(messages.some(message => message.type === 'ask.request')).toBe(false);
  sendCall(initial, 91, { query: 'needle' });
  await waitFor(() => messages.some(message => message.type === 'ask.request'));
  const ask = messages.find(message => message.type === 'ask.request')!;
  expect(ask).toMatchObject({ toolName: 'codex-cli:session_search',
    ask: { allowedScopes: ['once'], risk: 'high', resource: 'session' } });
  expect(await codexApprovals.resolve(ask.toolCallId,
    { type: 'permission', grant: 'once' }, ask.requestId)).toBe(true);
  await waitFor(() => initial.sent.some(message => message.id === 91));
  expect(initial.sent.find(message => message.id === 91)?.result).toMatchObject({ success: true });
  updateSession('s', { autoApproveSeverity: 'high' });
  sendCall(initial, 93, { sessionId: 's' });
  await waitFor(() => initial.sent.some(message => message.id === 93));
  expect(initial.sent.find(message => message.id === 93)?.result).toMatchObject({ success: true });
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(1);
  initial.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await first;
  const second = execution.sendMessage(wire(messages), 'origin', 's', 'again');
  await waitFor(() => processes[1]?.sent.some(message => message.method === 'turn/start') ?? false);
  const resumed = processes[1]!;
  expect(resumed.sent.find(message => message.method === 'thread/resume')?.params).not.toHaveProperty('dynamicTools');
  resumed.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  sendCall(resumed, 92, { action: 'list' });
  await waitFor(() => resumed.sent.some(message => message.id === 92));
  expect(resumed.sent.find(message => message.id === 92)?.result).toMatchObject({ success: true });
  resumed.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await second;
  expect(calls).toEqual([
    { input: { action: 'list' }, includeTools: true, risk: 'high' },
    { input: { query: 'needle' }, includeTools: true, risk: 'high' },
    { input: { sessionId: 's' }, includeTools: true, risk: 'high' },
    { input: { action: 'list' }, includeTools: true, risk: 'high' },
  ]);
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

function seedRollbackTurns(count = 2): { users: string[]; assistants: string[]; turns: Array<Record<string, unknown>> } {
  create();
  bindCodexThread({ sessionId: 's', threadId: 'thread-1', cliVersion: 'codex-cli 0.156.1',
    workspaceRoot: realpathSync(process.cwd()) });
  const users: string[] = [];
  const assistants: string[] = [];
  const turns: Array<Record<string, unknown>> = [];
  for (let index = 0; index < count; index++) {
    const userId = `user-${index}`;
    const assistantId = `assistant-${index}`;
    createMessage({ id: userId, sessionId: 's', role: 'user', createdAt: index * 2 + 1 });
    createPart({ id: `text-${index}`, messageId: userId, type: 'text', text: `question ${index}`,
      createdAt: index * 2 + 1 }, 's');
    createMessage({ id: assistantId, sessionId: 's', role: 'assistant', status: 'completed',
      modelId: 'codex-cli', providerId: 'codex-cli', tokens: { prompt: 0, completion: 0 }, cost: 0,
      createdAt: index * 2 + 2 });
    users.push(userId);
    assistants.push(assistantId);
    turns.push({ id: `turn-${index}`, status: 'completed', itemsView: 'full',
      items: [{ type: 'userMessage', clientId: userId }] });
  }
  return { users, assistants, turns };
}

test('Codex revert preserves the prior assistant and never reverts workspace files', async () => {
  const { users, assistants, turns } = seedRollbackTurns(3);
  const upstream = [...turns];
  const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: upstream }),
    undefined, false, undefined, false, false, false, before => {
      upstream.splice(upstream.findIndex(turn => turn.id === before));
    });
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const result = await execution.revert({ sessionId: 's', targetMessageId: assistants[1]! });
  expect(fake.sent.find(entry => entry.method === 'thread/revert')?.params).toEqual({
    threadId: 'thread-1', beforeTurnId: 'turn-2',
  });
  expect(result).toEqual({ revertedTo: { messageId: assistants[1], messageCount: 4 },
    removed: { messageIds: [users[2], assistants[2]], partCount: 1 } });
  expect(listMessagesWithParts('s').map(entry => entry.message.id)).toEqual([
    users[0], assistants[0], users[1], assistants[1],
  ]);
  expect(getRollbackIntent('s')).toBeNull();
});

test('Codex edit resumes an unloaded bound thread before reading and reverting history', async () => {
  const { users, turns } = seedRollbackTurns();
  const upstream = [...turns];
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1',
      status: { type: fake.sent.some(message => message.method === 'thread/resume') ? 'idle' : 'notLoaded' },
      turns: upstream }), undefined, false, undefined, false, false, false,
    before => { upstream.splice(upstream.findIndex(turn => turn.id === before)); });
    processes.push(fake);
    return fake.connection;
  } });
  const events: ServerMessage[] = [];
  const operation = execution.editMessage(wire(events), 'origin', {
    sessionId: 's', messageId: users[0]!, content: 'updated',
  });
  await waitFor(() => processes.some(fake => fake.sent.some(message => message.method === 'turn/start')));
  expect(processes[0]!.sent.map(message => message.method)).toEqual([
    'initialize', 'initialized', 'thread/resume', 'thread/read', 'thread/revert', 'thread/read',
  ]);
  expect(events.some(event => event.type === 'error')).toBe(false);
  processes.at(-1)!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-2' } } });
  processes.at(-1)!.send({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-2', status: 'completed' },
  } });
  await operation;
});

test('Codex edit refuses an active thread after resume without writing rollback intent', async () => {
  const { users, turns } = seedRollbackTurns();
  const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'active' }, turns }),
    undefined, false, undefined, false, false, false, undefined, 'active');
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const events: ServerMessage[] = [];
  await execution.editMessage(wire(events), 'origin', { sessionId: 's', messageId: users[0]!, content: 'changed' });
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'edit_error',
    message: 'Codex edit stopped before rollback: Codex thread is not idle after resume.' });
  expect(fake.sent.some(message => message.method === 'thread/read')).toBe(false);
  expect(fake.sent.some(message => message.method === 'thread/revert')).toBe(false);
  expect(getRollbackIntent('s')).toBeNull();
});

test('Codex edit retains the user ID and resubmits exactly one turn', async () => {
  const { users, turns } = seedRollbackTurns();
  const upstream = [...turns];
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: upstream }),
      undefined, false, undefined, false, false, false, before => {
        upstream.splice(upstream.findIndex(turn => turn.id === before));
      });
    processes.push(fake);
    return fake.connection;
  } });
  const events: ServerMessage[] = [];
  const operation = execution.editMessage(wire(events), 'origin', { sessionId: 's', messageId: users[0]!, content: 'updated' });
  await waitFor(() => processes.some(fake => fake.sent.some(entry => entry.method === 'turn/start')));
  const sent = processes.flatMap(fake => fake.sent).find(entry => entry.method === 'turn/start');
  expect(sent?.params).toMatchObject({ clientUserMessageId: users[0], input: [{ type: 'text', text: 'updated' }] });
  expect(listMessagesWithParts('s').filter(entry => entry.message.role === 'user')).toHaveLength(1);
  expect(listMessagesWithParts('s')[0]!.parts[0]).toMatchObject({ id: 'text-0', text: 'updated' });
  const running = processes.at(-1)!;
  running.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
  running.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  await operation;
  expect(getRollbackIntent('s')).toBeNull();
  expect(events.some(entry => entry.type === 'session.state')).toBe(true);
});

test('Codex edit keeps image parts and resends validated image inputs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-edit-images-'));
  Paths.configure({ dataDir: dir });
  try {
    const { users, turns } = seedRollbackTurns(1);
    const image = createAttachment({ sessionId: 's', workspaceId: 'ws', filename: 'photo.png',
      mimeType: 'image/png', sizeBytes: 2, data: new Uint8Array([1, 2]).buffer });
    createPart({ id: 'image-part', messageId: users[0]!, type: 'image', mimeType: 'image/png',
      url: `/api/sessions/s/attachments/${image.id}/content?key=${image.accessKey}`, createdAt: 1 }, 's');
    const upstream = [...turns];
    const processes: ReturnType<typeof fakeCodex>[] = [];
    const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
      const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: upstream }),
        undefined, false, undefined, false, false, false, before => {
          upstream.splice(upstream.findIndex(turn => turn.id === before));
        });
      processes.push(fake);
      return fake.connection;
    } });
    const operation = execution.editMessage(wire([]), 'origin', {
      sessionId: 's', messageId: users[0]!, content: 'another question',
    });
    await waitFor(() => processes.some(fake => fake.sent.some(entry => entry.method === 'turn/start')));
    expect(processes.flatMap(fake => fake.sent).find(entry => entry.method === 'turn/start')?.params)
      .toMatchObject({ input: [{ type: 'text', text: 'another question' },
        { type: 'localImage', path: realpathSync(image.absolutePath) }] });
    expect(listMessagesWithParts('s')[0]!.parts.map(part => part.id).sort()).toEqual(['image-part', 'text-0']);
    processes.at(-1)!.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    processes.at(-1)!.send({ method: 'turn/completed', params: {
      threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' },
    } });
    await operation;
  } finally {
    Paths.reset();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex rollback refuses incomplete history and active turns without mutating the transcript', async () => {
  const { users, turns } = seedRollbackTurns();
  const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' },
    turns: [{ ...turns[0], itemsView: 'partial' }, turns[1]] }));
  let launches = 0;
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    launches++;
    return fake.connection;
  } });
  await expect(execution.revert({ sessionId: 's', targetMessageId: users[0]! })).rejects.toThrow('incomplete');
  expect(fake.sent.some(entry => entry.method === 'thread/revert')).toBe(false);
  expect(getRollbackIntent('s')).toBeNull();
  expect(listMessagesWithParts('s')).toHaveLength(4);
  getDatabase().run('UPDATE codex_session_bindings SET pending_turn = 1 WHERE session_id = ?', ['s']);
  await expect(execution.revert({ sessionId: 's', targetMessageId: users[0]! })).rejects.toThrow('reconciliation');
  expect(launches).toBe(1);
});

test('Codex edit reports safe preflight cause without creating a rollback intent', async () => {
  const { users, turns } = seedRollbackTurns();
  const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' },
    turns: [{ ...turns[0], itemsView: 'summary' }, turns[1]] }));
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const events: ServerMessage[] = [];
  await execution.editMessage(wire(events), 'origin', {
    sessionId: 's', messageId: users[0]!, content: 'updated',
  });
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'edit_error',
    message: 'Codex edit stopped before rollback: Codex turn identity is incomplete.' });
  expect(getRollbackIntent('s')).toBeNull();
  expect(fake.sent.some(entry => entry.method === 'thread/revert')).toBe(false);
});

test('Codex edit hides upstream RPC text and marks uncertain rollback as blocked', async () => {
  const { users, turns } = seedRollbackTurns();
  const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns }), 'thread/revert');
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => fake.connection });
  const events: ServerMessage[] = [];
  await execution.editMessage(wire(events), 'origin', {
    sessionId: 's', messageId: users[0]!, content: 'updated',
  });
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'edit_error',
    message: 'Codex edit blocked: Codex rollback request or history read failed. Rollback may have run; do not retry or send in this session.' });
  expect(JSON.stringify(events)).not.toContain('secret upstream detail');
  expect(getRollbackIntent('s')?.phase).toBe('rollback');
});

test('uncertain Codex rollback blocks sends and recovers only after upstream prefix is proven', async () => {
  const { users, turns } = seedRollbackTurns();
  const upstream = [...turns];
  const connections: ReturnType<typeof fakeCodex>[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: upstream }),
      'thread/revert');
    connections.push(fake);
    return fake.connection;
  } });
  await expect(execution.revert({ sessionId: 's', targetMessageId: users[0]! })).rejects.toThrow();
  expect(getRollbackIntent('s')?.phase).toBe('rollback');
  const events: ServerMessage[] = [];
  await execution.sendMessage(wire(events), 'origin', 's', 'must not run');
  expect(events.at(-1)).toMatchObject({ type: 'error', code: 'invalid_session' });
  expect(connections).toHaveLength(1);
  await expect(execution.revert({ sessionId: 's', targetMessageId: users[0]! })).rejects.toThrow('uncertain');
  expect(connections[1]!.sent.some(entry => entry.method === 'thread/revert')).toBe(false);
  upstream.splice(0);
  const restarted = createCodexExecution({ version: () => 'codex-cli 0.156.1', connect: () => {
    const fake = fakeCodex(() => ({ id: 'thread-1', status: { type: 'idle' }, turns: upstream }),
      'thread/revert');
    connections.push(fake);
    return fake.connection;
  } });
  const result = await restarted.revert({ sessionId: 's', targetMessageId: users[0]! });
  expect(connections[2]!.sent.some(entry => entry.method === 'thread/revert')).toBe(false);
  expect(result.revertedTo.messageId).toBeNull();
  expect(listMessagesWithParts('s')).toHaveLength(0);
});

test('Codex advertises and routes only selected agent skill management on start and resume', async () => {
  create();
  updateSession('s', { agentId: 'test' });
  const dir = mkdtempSync(join(tmpdir(), 'codex-agent-execution-'));
  const processes: ReturnType<typeof fakeCodex>[] = [];
  const calls: string[] = [];
  const execution = createCodexExecution({ version: () => 'codex-cli 0.156.1',
    connect: () => { const fake = fakeCodex(); processes.push(fake); return fake.connection; },
    instructions: {
      listPreconfigs: async () => [], getPreconfig: async () => ({ id: 'test', skills: null }) as import('@prokopai/sdk').Preconfig,
      getAgentDirectory: async () => dir, readAgentMemoryFile: async () => null,
    },
    agentSkills: { definitions: () => ['agent_skill_manage', 'skill_manage'].map(name => ({
      type: 'function', name, description: name, inputSchema: { type: 'object' },
    })), execute: async (input, directory) => {
      calls.push(directory);
      return { success: true, action: 'list', skills: [], summary: String(input.action) };
    } },
  });
  try {
    const messages: ServerMessage[] = [];
    for (let index = 0; index < 2; index++) {
      const pending = execution.sendMessage(wire(messages), 'origin', 's', 'skills');
      await waitFor(() => processes[index]?.sent.some(message => message.method === 'turn/start') ?? false);
      const fake = processes[index]!;
      const thread = fake.sent.find(message => message.method === (index ? 'thread/resume' : 'thread/start'))?.params as Record<string, unknown>;
      if (!index) expect(thread.dynamicTools).toMatchObject([{ name: 'agent_skill_manage' }]);
      else expect(thread).not.toHaveProperty('dynamicTools');
      expect(thread.developerInstructions).toContain('Use agent_skill_manage');
      fake.send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
      for (const [offset, tool] of ['agent_skill_manage', 'skill_manage'].entries()) {
        const id = 110 + index * 2 + offset;
        fake.send({ id, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1',
          callId: `call-${id}`, namespace: null, tool, arguments: { action: 'list' } } });
        await waitFor(() => fake.sent.some(message => message.id === id));
        expect(fake.sent.find(message => message.id === id)?.result).toMatchObject({ success: !offset });
      }
      fake.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
      await pending;
    }
    expect(calls).toEqual([join(dir, 'skills'), join(dir, 'skills')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
