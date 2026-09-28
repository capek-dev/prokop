import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
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
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
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

test('approval is once-only and malformed or stale responses fail closed', async () => {
  const approvals = new ClaudeApprovals(() => 2000);
  const { requests, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', delivery, controller.signal)('Read',
    { file_path: 'README.md' }, options(controller.signal));
  const { toolCallId, requestId } = requests[0]!;
  expect(approvals.hasLiveRequest(requestId)).toBe(true);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'once' }, 'stale')).toBe(false);
  expect(await approvals.resolve(toolCallId, { type: 'permission', grant: 'workspace' }, requestId)).toBe(true);
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'denied' });
  const allowed = approvals.request('session', 'ws', delivery, controller.signal)('Read',
    { file_path: 'README.md' }, options(controller.signal));
  const next = requests[1]!;
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(true);
  expect(await allowed).toMatchObject({ behavior: 'allow' });
  expect(getPermissionRequestByRequestId(next.requestId)).toMatchObject({ status: 'approved' });
  expect(await approvals.resolve(next.toolCallId, { type: 'permission', grant: 'once' }, next.requestId)).toBe(false);
});

test('Stop and timeout deny and clean live waiters', async () => {
  const approvals = new ClaudeApprovals(() => 10);
  const { requests, delivery } = fixture();
  const controller = new AbortController();
  const wait = approvals.request('session', 'ws', delivery, controller.signal)('Bash',
    { command: 'echo test' }, options(controller.signal));
  const requestId = requests[0]!.requestId;
  controller.abort();
  expect(await wait).toMatchObject({ behavior: 'deny' });
  expect(approvals.hasLiveRequest(requestId)).toBe(false);
  expect(getPermissionRequestByRequestId(requestId)).toMatchObject({ status: 'expired' });
  const nextController = new AbortController();
  const timed = approvals.request('session', 'ws', delivery, nextController.signal)('Bash',
    { command: 'echo test' }, options(nextController.signal));
  expect(await timed).toMatchObject({ behavior: 'deny' });
  expect(getPermissionRequestByRequestId(requests[1]!.requestId)).toMatchObject({ status: 'expired' });
});

test('no controller and unsupported tools cannot request approval', async () => {
  const approvals = new ClaudeApprovals(() => 100);
  const { requests, delivery } = fixture();
  const signal = new AbortController().signal;
  expect(await approvals.request('session', 'ws', delivery, signal)('Task', {}, options(signal)))
    .toMatchObject({ behavior: 'deny' });
  removeSessionControl('session');
  expect(await approvals.request('session', 'ws', delivery, signal)('Read', {}, options(signal)))
    .toMatchObject({ behavior: 'deny' });
  expect(requests).toHaveLength(0);
});
