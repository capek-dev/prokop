import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { createAttachment } from '@/infrastructure/sqlite/attachments';
import { Paths } from '@/infrastructure/runtime/paths';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { getCodexBinding } from '@/harnesses/codex-cli/bindings';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { CodexApprovals, canAutoApproveCodexHook, codexApprovals } from '@/harnesses/codex-cli/approvals';
import { getPermissionRequestByRequestId, listPendingAsksBySession } from '@/infrastructure/sqlite/pending-asks';
import { saveCodexModelSelection } from '@/harnesses/codex-cli/models';
import { createCodexExecution } from '@/harnesses/codex-cli/execution';
import { hookCommand } from '@/harnesses/codex-cli/pretool-hook';
import type { CodexHookCall } from '@/harnesses/codex-cli/hook-policy';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';
import type { PermissionAsk, ServerMessage } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

function create(harness: 'prokop' | 'codex-cli' = 'codex-cli'): void {
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness });
}

function fakeCodex(readThread?: () => unknown, rejectMethod?: string, trustedHook = false): { connection: CodexConnection; sent: Record<string, unknown>[]; send(message: unknown): void } {
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
  await waitFor(() => listMessagesWithParts('s')[1]?.parts.filter(part => part.type === 'tool').length === 4);
  fake.connection.kill();
  await turn;
  const tools = listMessagesWithParts('s')[1]!.parts.filter(part => part.type === 'tool');
  expect(tools.map(part => [part.name, part.state.status]).sort()).toEqual([
    ['Codex command', 'completed'], ['Codex file change', 'completed'],
    ['Codex MCP', 'interrupted'], ['Codex tool', 'error'],
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
  expect(messages.filter(message => message.type === 'part.created' && message.part.type === 'tool')).toHaveLength(4);
  expect(messages.filter(message => message.type === 'part.updated' && message.part.type === 'tool')).toHaveLength(4);
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
  let onCall!: (call: CodexHookCall) => Promise<boolean>;
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
  expect(await onCall({ ...call, turn_id: 'other' })).toBe(false);
  expect(messages.filter(message => message.type === 'ask.request')).toHaveLength(0);
  const denied = onCall(call);
  await waitFor(() => messages.filter(message => message.type === 'ask.request').length === 1);
  const firstAsk = messages.find(message => message.type === 'ask.request')!;
  expect(firstAsk.ask).toMatchObject({ allowedScopes: ['once'], action: 'delete' });
  expect(await codexApprovals.resolve(firstAsk.toolCallId, { type: 'permission', grant: 'denied' }, firstAsk.requestId)).toBe(true);
  expect(await denied).toBe(false);
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
