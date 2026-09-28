import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { getPermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { ClaudeApprovals } from '@/harnesses/claude-cli/approvals';
import { handleClientRegistration, registerConnection, unregisterConnection } from '@/transport/websocket/connection-registry';
import { handleClaim, removeSessionControl } from '@/transport/websocket/control-registry';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';

let connection: ReturnType<typeof registerConnection>;
let socket: object;
beforeEach(() => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    autoApproveSeverity: 'off', preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
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
    { file_path: 'README.md' }, options(controller.signal));
  const { toolCallId, requestId } = requests[0]!;
  expect(approvals.hasLiveRequest(requestId)).toBe(true);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'once' }, 'stale')).toBe(false);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'workspace' }, requestId)).toBe(true);
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'denied' });
  const allowed = approvals.request('session', 'ws', root, delivery, controller.signal)('Read',
    { file_path: 'README.md' }, options(controller.signal));
  const next = requests[1]!;
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(true);
  expect(await allowed).toMatchObject({ behavior: 'allow' });
  expect(getPermissionRequestByRequestId(next.requestId)).toMatchObject({ status: 'approved' });
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(false);
});

test('child-owned approval reaches the parent controller and replays under the child', async () => {
  createSession({ id: 'child', workspaceId: 'ws', title: 'Claude child', status: 'active',
    autoApproveSeverity: 'off', preconfigId: null, metadata: null, parentId: 'session',
    agentName: null, harness: 'claude-cli' });
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, notifications, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', root, delivery, controller.signal,
    toolUseId => toolUseId === 'child-tool' ? 'child' : null)('Bash',
    { command: 'echo test' }, { ...options(controller.signal), toolUseID: 'child-tool' });
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
    { command: 'echo test' }, options(controller.signal));
  const requestId = requests[0]!.requestId;
  controller.abort();
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(approvals.hasLiveRequest(requestId)).toBe(false);
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'expired' });
  const nextController = new AbortController();
  const timed = approvals.request('session', 'ws', root, delivery, nextController.signal)('Bash',
    { command: 'echo test' }, options(nextController.signal));
  expect(await timed).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requests[1]!.requestId)).toMatchObject({ status: 'expired' });
});

test('Claude tool risks follow the persisted session ceiling with once-only manual fallback', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, delivery } = fixture();
  const signal = new AbortController().signal;
  const use = approvals.request('session', 'ws', root, delivery, signal);
  const cases: Array<{ ceiling: 'off' | 'low' | 'medium' | 'high'; tool: string;
    input: Record<string, unknown>; risk: string; automatic: boolean }> = [
    { ceiling: 'low', tool: 'Read', input: { file_path: 'README.md' }, risk: 'low', automatic: true },
    { ceiling: 'low', tool: 'Glob', input: { pattern: '*.ts' }, risk: 'low', automatic: true },
    { ceiling: 'low', tool: 'Grep', input: { pattern: 'hello' }, risk: 'low', automatic: true },
    { ceiling: 'low', tool: 'Bash', input: { command: 'pwd' }, risk: 'low', automatic: true },
    { ceiling: 'low', tool: 'Write', input: { file_path: 'new.txt', content: 'hi' }, risk: 'medium', automatic: false },
    { ceiling: 'medium', tool: 'Edit', input: { file_path: 'README.md', old_string: 'one', new_string: 'two' }, risk: 'medium', automatic: true },
    { ceiling: 'medium', tool: 'WebSearch', input: { query: 'docs' }, risk: 'medium', automatic: true },
    { ceiling: 'medium', tool: 'Bash', input: { command: 'mkdir new-dir' }, risk: 'medium', automatic: true },
    { ceiling: 'medium', tool: 'WebFetch', input: { url: 'https://example.com' }, risk: 'high', automatic: false },
    { ceiling: 'medium', tool: 'Read', input: { file_path: '.env' }, risk: 'high', automatic: false },
    { ceiling: 'medium', tool: 'Grep', input: { pattern: '.pem' }, risk: 'high', automatic: false },
    { ceiling: 'high', tool: 'WebFetch', input: { url: 'https://example.com' }, risk: 'high', automatic: true },
    { ceiling: 'high', tool: 'Read', input: { file_path: '../outside.txt' }, risk: 'high', automatic: true },
    { ceiling: 'high', tool: 'Bash', input: { command: 'rm file.txt' }, risk: 'high', automatic: true },
    { ceiling: 'off', tool: 'Read', input: { file_path: 'README.md' }, risk: 'low', automatic: false },
  ];
  for (const item of cases) {
    updateSession('session', { autoApproveSeverity: item.ceiling });
    const previous = requests.length;
    const result = use(item.tool, item.input, options(signal));
    if (item.automatic) {
      expect(await result).toMatchObject({ behavior: 'allow' });
      expect(requests).toHaveLength(previous);
    } else {
      expect(requests).toHaveLength(previous + 1);
      const ask = requests[previous] as { ask: { risk: string; allowedScopes: string[] }; toolCallId: string; requestId: string };
      expect(ask.ask).toMatchObject({ risk: item.risk, allowedScopes: ['once'] });
      expect(await approvals.resolve(ask.toolCallId, { type: 'permission', grant: 'once' }, ask.requestId)).toBe(true);
      expect(await result).toMatchObject({ behavior: 'allow' });
    }
  }
});

test('blocked paths, malformed tools and aborted calls cannot auto-approve', async () => {
  updateSession('session', { autoApproveSeverity: 'high' });
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

test('unclassified SDK tools run without a risk ask, including when auto-approval is off', async () => {
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
  expect(await use('Read', { file_path: 'README.md' }, options(signal))).toMatchObject({ behavior: 'deny' });
  expect(requests).toHaveLength(0);
});
