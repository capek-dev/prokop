import { afterEach, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { connect as connectSocket } from 'node:net';
import { dirname } from 'node:path';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';
import { createPretoolChannel, hookCommand } from '@/harnesses/codex-cli/pretool-hook';
import type { CodexHookCall } from '@/harnesses/codex-cli/hook-policy';

const connections: Array<{ args: string[]; env: Record<string, string | undefined> }> = [];
const hash = `sha256:${'a'.repeat(64)}`;
const hook = { key: '/<session-flags>/config.toml:pre_tool_use:0:0', currentHash: hash,
  eventName: 'preToolUse', source: 'sessionFlags', enabled: true, trustStatus: 'untrusted',
  matcher: '^(Bash|apply_patch)$', command: hookCommand() };

function fakeSpawn(args: string[] = [], env: Record<string, string | undefined> = {}): CodexConnection {
  connections.push({ args, env });
  let output!: ReadableStreamDefaultController<Uint8Array>;
  return {
    stdout: new ReadableStream({ start(controller) { output = controller; } }),
    stdin: { write(bytes) {
      const message = JSON.parse(new TextDecoder().decode(bytes)) as { id?: number; method?: string };
      if (message.id !== undefined) {
        const result = message.method === 'hooks/list'
          ? { data: [{ hooks: [hook], warnings: [], errors: [] }] } : {};
        queueMicrotask(() => output.enqueue(new TextEncoder().encode(`${JSON.stringify({ id: message.id, result })}\n`)));
      }
      return bytes.length;
    } },
    exited: new Promise(() => {}),
    kill: () => { try { output.close(); } catch { /* Already closed. */ } },
  };
}

const call: CodexHookCall = { session_id: 'thread', turn_id: 'turn', tool_use_id: 'item',
  hook_event_name: 'PreToolUse', cwd: '/workspace', tool_name: 'Bash', tool_input: { command: 'cat .env' } };

function send(socketPath: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(socketPath);
    let result = '';
    socket.setTimeout(1000, () => socket.destroy(new Error('Socket test timed out')));
    socket.on('connect', () => socket.end(body));
    socket.on('data', chunk => { result += chunk.toString(); });
    socket.on('end', () => resolve(result));
    socket.on('error', reject);
  });
}

afterEach(() => { connections.length = 0; });

test.skipIf(process.platform === 'win32')('private hook socket rejects invalid payloads and closes after the turn', async () => {
  const seen: CodexHookCall[] = [];
  const channel = await createPretoolChannel(async value => { seen.push(value); return true; }, fakeSpawn);
  const { env, args } = connections[0]!;
  const path = env.PROKOPAI_CODEX_HOOK_SOCKET!;
  const token = env.PROKOPAI_CODEX_HOOK_TOKEN!;
  try {
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(args).not.toContain('--dangerously-bypass-hook-trust');
    expect(await send(path, JSON.stringify({ token: 'wrong', call }))).toBe('deny');
    expect(await send(path, '{bad json')).toBe('deny');
    expect(await send(path, JSON.stringify({ token, call: { ...call, tool_name: 'WebSearch' } }))).toBe('deny');
    expect(await send(path, 'x'.repeat(128 * 1024 + 1))).not.toBe('allow');
    expect(seen).toHaveLength(0);
    expect(await send(path, JSON.stringify({ token, call }))).toBe('allow');
    expect(seen).toEqual([call]);
    const trusted = channel.connect();
    expect(connections[1]!.args).toContain(`hooks.state={${JSON.stringify(hook.key)}={trusted_hash=${JSON.stringify(hash)}}}`);
    trusted.kill();
  } finally {
    await channel.close();
  }
  expect(existsSync(path)).toBe(false);
  expect(existsSync(dirname(path))).toBe(false);
});
