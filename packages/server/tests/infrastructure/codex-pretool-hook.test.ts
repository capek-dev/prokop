import { expect, spyOn, test } from 'bun:test';
import { connect } from 'node:net';
import { classifyCodexHook, validHookCall, type CodexHookCall } from '@/harnesses/codex-cli/hook-policy';
import { createPretoolChannel, hookCommand, hookConfig, selectProkopHook } from '@/harnesses/codex-cli/pretool-hook';
import type { CodexConnection } from '@/harnesses/codex-cli/app-server';
import { logCodexPermissionDenial } from '@/harnesses/codex-cli/permission-diagnostics';

const root = '/workspace';
const base: CodexHookCall = {
  session_id: 'thread-1', turn_id: 'turn-1', tool_use_id: 'call-1',
  hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Bash', tool_input: { command: 'ls' },
};

function shell(command: string): ReturnType<typeof classifyCodexHook> {
  return classifyCodexHook({ ...base, tool_input: { command } }, root);
}

test('classifies sensitive reads, outside paths and recognizable deletion, but not ordinary reads', () => {
  expect(shell('ls')).toBeNull();
  expect(shell("/bin/zsh -lc 'cat .env'")).toMatchObject({ concerns: ['sensitive'] });
  expect(shell('cat ../private.txt')).toMatchObject({ concerns: ['escape'] });
  expect(shell('rm -rf ./generated')).toMatchObject({ concerns: ['destructive'] });
  expect(shell('printf hello')).toBeNull();
});

test('classifies patch edits, sensitive paths, outside writes and deletions', () => {
  const patch = (command: string) => classifyCodexHook({ ...base, tool_name: 'apply_patch', tool_input: { command } }, root);
  expect(patch('*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch')).toBeNull();
  expect(patch('*** Begin Patch\n*** Update File: .env\n*** End Patch')).toMatchObject({ resource: 'file' });
  expect(patch('*** Begin Patch\n*** Add File: ../outside.txt\n*** End Patch')).toMatchObject({ resource: 'file' });
  expect(patch('*** Begin Patch\n*** Delete File: src/old.ts\n*** End Patch')).toMatchObject({ resource: 'file' });
  expect(patch('not a patch')).toBeUndefined();
});

test('rejects malformed hook calls and does not classify unknown tools', () => {
  expect(validHookCall({ ...base, tool_name: 'WebSearch' })).toBe(false);
  expect(validHookCall({ ...base, turn_id: '' })).toBe(false);
  expect(classifyCodexHook({ ...base, tool_input: { command: '' } }, root)).toBeUndefined();
});

const hash = `sha256:${'a'.repeat(64)}`;
const entry = { key: '/<session-flags>/config.toml:pre_tool_use:0:0', currentHash: hash,
  eventName: 'preToolUse', source: 'sessionFlags', enabled: true, trustStatus: 'untrusted',
  matcher: '^(Bash|apply_patch)$', command: hookCommand() };
const list = (hook: unknown) => ({ data: [{ hooks: [hook], warnings: [], errors: [] }] });

test('launch-only hook requires exact session-flags trust state and no discovery errors', () => {
  expect(hookConfig()).toContain('hooks.PreToolUse');
  expect(hookCommand()).toContain('unknown or not-yet-started agent turn');
  expect(hookCommand()).toContain('working directory outside selected root');
  expect(selectProkopHook(list(entry), 'untrusted').currentHash).toBe(hash);
  expect(selectProkopHook(list({ ...entry, trustStatus: 'trusted' }), 'trusted').key).toBe(entry.key);
  expect(selectProkopHook(list({ ...entry, trustStatus: 'trusted' }), 'either').key).toBe(entry.key);
  expect(() => selectProkopHook(list({ ...entry, command: 'other' }), 'either')).toThrow();
  expect(() => selectProkopHook(list(entry), 'trusted')).toThrow();
  expect(() => selectProkopHook(list({ ...entry, source: 'user' }), 'untrusted')).toThrow();
  expect(() => selectProkopHook({ data: [{ hooks: [entry], errors: ['invalid'] }] }, 'untrusted')).toThrow();
});

test('hook socket logs fixed denial codes without printing command or token', async () => {
  let env: Record<string, string | undefined> | undefined;
  const spawn = (_args: string[] = [], receivedEnv?: Record<string, string | undefined>): CodexConnection => {
    env = receivedEnv;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    return {
      stdout: new ReadableStream({ start(c) { controller = c; } }),
      stdin: { write(bytes) {
        const message = JSON.parse(new TextDecoder().decode(bytes)) as { id?: number; method?: string };
        if (message.id === undefined) return bytes.length;
        const result = message.method === 'hooks/list' ? list(entry) : {};
        queueMicrotask(() => controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ id: message.id, result })}\n`)));
        return bytes.length;
      } },
      exited: new Promise(() => {}),
      kill: () => { try { controller.close(); } catch { /* Already closed. */ } },
    };
  };
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  const channel = await createPretoolChannel(async () => 'unknown-turn', spawn);
  const sendRaw = (payload: string): Promise<string> => new Promise((resolve, reject) => {
    const socket = connect(env!.PROKOPAI_CODEX_HOOK_SOCKET!);
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.end(payload));
    socket.on('data', part => { reply += part; });
    socket.on('end', () => resolve(reply));
    socket.on('error', reject);
  });
  const send = (token: string, call: unknown): Promise<string> => sendRaw(JSON.stringify({ token, call }));
  try {
    const secret = 'private-command-value';
    expect(await send(env!.PROKOPAI_CODEX_HOOK_TOKEN!, { ...base, tool_input: { command: secret } }))
      .toBe('deny:unknown-turn');
    expect(await send(env!.PROKOPAI_CODEX_HOOK_TOKEN!, { ...base, turn_id: '' }))
      .toBe('deny');
    expect(await send('wrong-token', base)).toBe('deny');
    expect(await sendRaw('{invalid-json')).toBe('deny');
    expect(warning.mock.calls.map(args => args.join(' '))).toEqual([
      '[codex-permission] hook denied: unknown-turn',
      '[codex-permission] hook denied: invalid-payload',
      '[codex-permission] hook denied: invalid-token',
      '[codex-permission] hook denied: invalid-payload',
    ]);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(env!.PROKOPAI_CODEX_HOOK_TOKEN!);
  } finally {
    await channel.close();
    warning.mockRestore();
  }
});

test('permission diagnostics emit only fixed stage and reason', () => {
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    logCodexPermissionDenial('native', 'working-directory');
    expect(warning).toHaveBeenCalledWith('[codex-permission] native denied: working-directory');
  } finally { warning.mockRestore(); }
});
