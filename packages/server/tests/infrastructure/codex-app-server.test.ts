import { expect, test } from 'bun:test';
import { CodexAppServer, type CodexConnection } from '@/harnesses/codex-cli/app-server';

function fixture() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const outgoing: Record<string, unknown>[] = [];
  const encoder = new TextEncoder();
  const io: CodexConnection = {
    stdout: new ReadableStream({ start(c) { controller = c; } }),
    stdin: { write(bytes) {
      for (const line of new TextDecoder().decode(bytes).trim().split('\n')) {
        outgoing.push(JSON.parse(line) as Record<string, unknown>);
      }
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill: () => { try { controller.close(); } catch { /* Already closed. */ } },
  };
  return {
    io, outgoing,
    send: (message: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`)),
    async waitFor(count: number) {
      for (let i = 0; i < 100 && outgoing.length < count; i++) await Bun.sleep(1);
      expect(outgoing).toHaveLength(count);
    },
  };
}

test('initialize waits for its response before the initialized notification', async () => {
  const f = fixture();
  const events: unknown[] = [];
  const client = new CodexAppServer(f.io, event => events.push(event));
  const initialized = client.initialize();
  await f.waitFor(1);
  expect(f.outgoing[0]?.method).toBe('initialize');
  expect(f.outgoing[0]?.id).toBe(1);
  expect(f.outgoing[0]?.params).toMatchObject({ capabilities: null });
  f.send({ id: 1, result: { userAgent: 'codex' } });
  await initialized;
  expect(f.outgoing[1]).toMatchObject({ method: 'initialized' });
  const request = client.request('thread/start', { cwd: '/project' });
  await f.waitFor(3);
  f.send({ method: 'turn/started', params: { threadId: 't', turn: { id: 'r' } } });
  f.send({ id: 2, result: { thread: { id: 't' } } });
  expect(await request).toEqual({ thread: { id: 't' } });
  expect(events).toEqual([{ method: 'turn/started', params: { threadId: 't', turn: { id: 'r' } } }]);
  await client.close();
});

test('server-initiated approvals deny by default and malformed traffic closes requests', async () => {
  const f = fixture();
  const client = new CodexAppServer(f.io, () => {});
  f.send({ id: 27, method: 'item/commandExecution/requestApproval', params: { threadId: 't', turnId: 'r' } });
  f.send({ id: 28, method: 'item/fileChange/requestApproval', params: { threadId: 't', turnId: 'r' } });
  f.send({ id: 29, method: 'item/permissions/requestApproval', params: {} });
  f.send({ id: 30, method: 'unknown/request', params: {} });
  f.send({ id: 31, method: 'mcpServer/elicitation/request', params: {} });
  await f.waitFor(5);
  expect([...f.outgoing].sort((a, b) => Number(a.id) - Number(b.id))).toEqual([
    { id: 27, result: { decision: 'decline' } },
    { id: 28, result: { decision: 'decline' } },
    { id: 29, result: { permissions: {}, scope: 'turn' } },
    { id: 30, error: { code: -32601, message: 'Unsupported request' } },
    { id: 31, result: { action: 'decline', content: null, _meta: null } },
  ]);
  const request = client.request('thread/resume', { threadId: 't' });
  await f.waitFor(6);
  f.send({ bad: true });
  await expect(request).rejects.toThrow('connection lost');
  await client.close();
});

test('request timeout removes its waiter without reusing a request id', async () => {
  const f = fixture();
  const client = new CodexAppServer(f.io, () => {});
  await expect(client.request('thread/read', {}, 5)).rejects.toThrow('timed out');
  const next = client.request('thread/read', {}, 100);
  await f.waitFor(2);
  expect(f.outgoing.map(item => item.id)).toEqual([1, 2]);
  f.send({ id: 1, result: { thread: { id: 'stale' } } });
  f.send({ id: 2, result: { thread: { id: 'current' } } });
  expect(await next).toEqual({ thread: { id: 'current' } });
  await client.close();
});
