import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { updateWorkspace } from '@/infrastructure/sqlite/workspaces';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { ClaudeApprovals } from '@/harnesses/claude-cli/approvals';
import { handleClientRegistration, registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { installHarnessNotificationPort } from '@/application/ports/harness-notifications';

let connection: ReturnType<typeof registerConnection>;
let socket: object;
beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    permissionMode: 'standard', preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  socket = {};
  connection = registerConnection(socket);
  handleClientRegistration(connection, { type: 'client.register', client: { clientId: 'controller',
    clientType: 'web', displayName: 'controller', interactionMode: 'human', capabilities: [] } }, () => {});
  handleClaim('session', connection);
});
afterEach(() => {
  removeSessionControl('session');
  unregisterConnection(socket);
  resetTestDatabase();
});

function fixture() {
  const requests: Array<{ toolCallId: string; requestId: string }> = [];
  const notifications: unknown[] = [];
  const delivery = { sendToAskTargets: (_session: string, _authority: unknown, message: unknown) => {
    requests.push(message as { toolCallId: string; requestId: string });
  }, broadcastToSession: (_session: string, message: unknown) => notifications.push(message) } as unknown as ApplicationDeliveryPort<unknown>;
  return { requests, notifications, delivery };
}
const options = (signal: AbortSignal) => ({ signal, requestId: crypto.randomUUID(), toolUseID: crypto.randomUUID() });

const root = process.cwd();

test('approval is once-only and malformed or stale responses fail closed', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', root, delivery, controller.signal)('Read',
    { file_path: '.env' }, options(controller.signal));
  const { toolCallId, requestId } = requests[0]!;
  expect(approvals.hasLiveRequest(requestId)).toBe(true);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'once' }, 'stale')).toBe(false);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'workspace' }, requestId)).toBe(true);
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'denied' });
  const allowed = approvals.request('session', 'ws', root, delivery, controller.signal)('Read',
    { file_path: '.env' }, options(controller.signal));
  const next = requests[1]!;
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(true);
  expect(await allowed).toMatchObject({ behavior: 'allow' });
  expect(getPermissionRequestByRequestId(next.requestId)).toMatchObject({ status: 'approved' });
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(false);
});

test('prokop mcp tools pass the SDK gate while memory availability is enforced', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { delivery } = fixture();
  const controller = new AbortController();
  const gate = approvals.request('session', 'ws', root, delivery, controller.signal);
  expect(await gate('mcp__prokop__memory', { action: 'list', target: 'user' }, options(controller.signal)))
    .toMatchObject({ behavior: 'deny', message: 'Workspace memory is disabled' });
  updateWorkspace('ws', { settings: { memory: { enabled: true, permissionRisk: 'high' } } });
  expect(await gate('mcp__prokop__memory', { action: 'add', target: 'memory', content: 'fact' },
    options(controller.signal))).toMatchObject({ behavior: 'allow' });
  expect(await gate('mcp__prokop__agent_memory', { action: 'list', target: 'user' },
    options(controller.signal))).toMatchObject({ behavior: 'allow' });
  expect(await gate('mcp__prokop__agent_skill_manage', { action: 'list' },
    options(controller.signal))).toMatchObject({ behavior: 'allow' });
  // Session search is always on: the gate passes before any settings write.
  expect(await gate('mcp__prokop__session_search', { action: 'list' }, options(controller.signal)))
    .toMatchObject({ behavior: 'allow' });
  expect(await gate('mcp__prokop__session_search', { query: 'deploy' }, options(controller.signal)))
    .toMatchObject({ behavior: 'allow' });
});

test('child-owned approval reaches the parent controller and replays under the child', async () => {
  createSession({ id: 'child', workspaceId: 'ws', title: 'Claude child', status: 'active',
    permissionMode: 'standard', preconfigId: null, metadata: null, parentId: 'session',
    agentName: null, harness: 'claude-cli' });
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, notifications, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', root, delivery, controller.signal,
    toolUseId => toolUseId === 'child-tool' ? 'child' : null)('Bash',
    { command: 'rm -rf notes.txt' }, { ...options(controller.signal), toolUseID: 'child-tool' });
  const ask = requests[0] as { sessionId: string; ask: { _originSessionId: string };
    toolCallId: string; requestId: string };
  expect(ask).toMatchObject({ sessionId: 'session', ask: { _originSessionId: 'child' } });
  expect(getPermissionRequestByRequestId(ask.requestId)).toMatchObject({
    sessionId: 'child', rootSessionId: 'session', status: 'pending',
  });
  expect(approvals.getSessionId(ask.toolCallId, ask.requestId)).toBe('session');
  expect(await approvals.resolve(ask.toolCallId, { type: 'permission', grant: 'once' }, ask.requestId)).toBe(true);
  expect(await wait).toMatchObject({ behavior: 'allow' });
  expect(notifications).toContainEqual({ type: 'ask.timeout', sessionId: 'session',
    toolCallId: ask.toolCallId, requestId: ask.requestId });
});

test('Stop and timeout deny and clean live waiters', async () => {
  const approvals = new ClaudeApprovals(() => 10);
  const { requests, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', root, delivery, controller.signal)('Bash',
    { command: 'rm -rf notes.txt' }, options(controller.signal));
  const requestId = requests[0]!.requestId;
  controller.abort();
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(approvals.hasLiveRequest(requestId)).toBe(false);
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'expired' });
  const nextController = new AbortController();
  const timed = approvals.request('session', 'ws', root, delivery, nextController.signal)('Bash',
    { command: 'rm -rf notes.txt' }, options(nextController.signal));
  expect(await timed).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requests[1]!.requestId)).toMatchObject({ status: 'expired' });
});

test('Claude tool concerns follow the session mode with once-only destructive fallback', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, delivery } = fixture();
  const signal = new AbortController().signal;
  const use = approvals.request('session', 'ws', root, delivery, signal);
  const cases: Array<{ ceiling: 'standard' | 'extended' | 'full'; tool: string;
    input: Record<string, unknown>; risk?: string; scopes?: string[]; automatic: boolean }> = [
    // Clean workspace operations and plain fetches auto-run at every mode.
    { ceiling: 'standard', tool: 'Read', input: { file_path: 'README.md' }, automatic: true },
    { ceiling: 'standard', tool: 'Glob', input: { pattern: '*.ts' }, automatic: true },
    { ceiling: 'standard', tool: 'Grep', input: { pattern: 'hello' }, automatic: true },
    { ceiling: 'standard', tool: 'Bash', input: { command: 'pwd' }, automatic: true },
    { ceiling: 'standard', tool: 'Write', input: { file_path: 'new.txt', content: 'hi' }, automatic: true },
    { ceiling: 'standard', tool: 'Edit', input: { file_path: 'README.md', old_string: 'one', new_string: 'two' }, automatic: true },
    { ceiling: 'standard', tool: 'WebSearch', input: { query: 'docs' }, automatic: true },
    { ceiling: 'standard', tool: 'WebFetch', input: { url: 'https://example.com' }, automatic: true },
    { ceiling: 'standard', tool: 'Bash', input: { command: 'rm file.txt' }, automatic: true },
    // Sensitive targets ask below full; the ask may be remembered.
    { ceiling: 'standard', tool: 'Read', input: { file_path: '.env' }, risk: 'high', scopes: ['once', 'session', 'workspace'], automatic: false },
    { ceiling: 'extended', tool: 'Grep', input: { pattern: '.pem' }, risk: 'high', scopes: ['once', 'session', 'workspace'], automatic: false },
    { ceiling: 'full', tool: 'Read', input: { file_path: '.env' }, automatic: true },
    // Escape asks at standard and unlocks at extended.
    { ceiling: 'standard', tool: 'Read', input: { file_path: '../outside.txt' }, risk: 'medium', scopes: ['once', 'session', 'workspace'], automatic: false },
    { ceiling: 'extended', tool: 'Read', input: { file_path: '../outside.txt' }, automatic: true },
    // Destructive shell asks below full and is once-only.
    { ceiling: 'standard', tool: 'Bash', input: { command: 'rm -rf build' }, risk: 'high', scopes: ['once'], automatic: false },
    { ceiling: 'full', tool: 'Bash', input: { command: 'rm -rf build' }, automatic: true },
  ];
  for (const item of cases) {
    updateSession('session', { permissionMode: item.ceiling });
    const previous = requests.length;
    const result = use(item.tool, item.input, options(signal));
    if (item.automatic) {
      expect(await result).toMatchObject({ behavior: 'allow' });
      expect(requests).toHaveLength(previous);
    } else {
      expect(requests).toHaveLength(previous + 1);
      const ask = requests[previous] as { ask: { risk: string; allowedScopes: string[] }; toolCallId: string; requestId: string };
      expect(ask.ask).toMatchObject({ risk: item.risk, allowedScopes: item.scopes });
      expect(await approvals.resolve(ask.toolCallId, { type: 'permission', grant: 'once' }, ask.requestId)).toBe(true);
      expect(await result).toMatchObject({ behavior: 'allow' });
    }
  }
});

test('remembered Bash grants persist and replay without asking', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, delivery } = fixture();
  const controller = new AbortController();
  const use = approvals.request('session', 'ws', root, delivery, controller.signal);
  const first = use('Bash', { command: 'cat /etc/release' }, options(controller.signal));
  const ask = requests[0]! as { ask: { concerns: string[]; allowedScopes: string[] };
    toolCallId: string; requestId: string };
  expect(ask.ask).toMatchObject({ concerns: ['escape'], allowedScopes: ['once', 'session', 'workspace'] });
  expect(await approvals.resolve(ask.toolCallId, { type: 'permission', grant: 'session' }, ask.requestId)).toBe(true);
  expect(await first).toMatchObject({ behavior: 'allow' });
  // The same command replays through the remembered grant, no new ask.
  expect(await use('Bash', { command: 'cat /etc/release' }, options(controller.signal))).toMatchObject({ behavior: 'allow' });
  expect(requests).toHaveLength(1);
  // A different command still asks; its workspace grant also persists.
  const second = use('Bash', { command: 'cat /etc/issue' }, options(controller.signal));
  expect(requests).toHaveLength(2);
  const secondAsk = requests[1]! as { toolCallId: string; requestId: string };
  expect(await approvals.resolve(secondAsk.toolCallId, { type: 'permission', grant: 'workspace' }, secondAsk.requestId)).toBe(true);
  expect(await second).toMatchObject({ behavior: 'allow' });
});

test('blocked paths, malformed tools and aborted calls cannot auto-approve', async () => {
  updateSession('session', { permissionMode: 'full' });
  const approvals = new ClaudeApprovals();
  const { requests, delivery } = fixture();
  const signal = new AbortController().signal;
  const use = approvals.request('session', 'ws', root, delivery, signal);
  for (const [tool, input] of [
    ['Read', {}], ['Bash', { command: '' }], ['WebFetch', { url: 'file:///etc/passwd' }],
    ['Grep', { pattern: 'hello', path: null }],
  ] as const) expect(await use(tool, input, options(signal))).toMatchObject({ behavior: 'deny' });
  expect(await use('Task', [] as never, options(signal))).toMatchObject({ behavior: 'deny' });
  expect(await use('Agent', null as never, options(signal))).toMatchObject({ behavior: 'deny' });
  expect(await use('Read', { file_path: 'README.md' }, { ...options(signal), blockedPath: '/etc' }))
    .toMatchObject({ behavior: 'deny' });
  expect(await use('Agent', { prompt: 'inspect' }, { ...options(signal), blockedPath: '/etc' }))
    .toMatchObject({ behavior: 'deny' });
  const aborted = new AbortController();
  aborted.abort();
  expect(await use('Read', { file_path: 'README.md' }, options(aborted.signal))).toMatchObject({ behavior: 'deny' });
  expect(await use('Agent', { prompt: 'inspect' }, options(aborted.signal))).toMatchObject({ behavior: 'deny' });
  expect(requests).toHaveLength(0);
});

test('unclassified SDK tools run without a risk ask, with or without a controller', async () => {
  const approvals = new ClaudeApprovals();
  const { requests, delivery } = fixture();
  const signal = new AbortController().signal;
  const use = approvals.request('session', 'ws', root, delivery, signal);
  for (const name of ['Agent', 'Task', 'NotebookEdit', 'FutureBuiltin']) {
    expect(await use(name, { prompt: 'inspect workspace' }, options(signal))).toMatchObject({ behavior: 'allow' });
  }
  expect(requests).toHaveLength(0);
  removeSessionControl('session');
  expect(await use('Agent', { prompt: 'inspect workspace' }, options(signal))).toMatchObject({ behavior: 'allow' });
  // Asking-risk reads without a controller fail closed; the standard-mode
  // low-risk floor needs no controller by design.
  expect(await use('Read', { file_path: '.env' }, options(signal))).toMatchObject({ behavior: 'deny' });
  expect(requests).toHaveLength(0);
});

test('a waiting ask pushes a permission notification, except in learning review sessions', async () => {
  const pushed: Array<[string, string]> = [];
  installHarnessNotificationPort({ notifyTerminalMessage: () => {},
    notifyPermissionRequired: (requestId, rootSessionId) => { pushed.push([requestId, rootSessionId]); } });
  try {
    const approvals = new ClaudeApprovals(() => 2000);
    const { requests, delivery } = fixture();
    const controller = new AbortController();
    const wait = approvals.request('session', 'ws', root, delivery, controller.signal)('Read',
      { file_path: '.env' }, options(controller.signal));
    expect(pushed).toEqual([[requests[0]!.requestId, 'session']]);
    await approvals.resolve(requests[0]!.toolCallId, { type: 'permission', grant: 'once' }, requests[0]!.requestId);
    await wait;
    updateSession('session', { metadata: { learningRunId: 'run-1' } });
    const learning = approvals.request('session', 'ws', root, delivery, controller.signal)('Read',
      { file_path: '.env' }, options(controller.signal));
    expect(requests).toHaveLength(2);
    expect(pushed).toHaveLength(1);
    await approvals.resolve(requests[1]!.toolCallId, { type: 'permission', grant: 'once' }, requests[1]!.requestId);
    await learning;
  } finally {
    installHarnessNotificationPort({ notifyTerminalMessage: () => {}, notifyPermissionRequired: () => {} });
  }
});
