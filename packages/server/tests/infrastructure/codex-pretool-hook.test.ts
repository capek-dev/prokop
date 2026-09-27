import { expect, test } from 'bun:test';
import { classifyCodexHook, validHookCall, type CodexHookCall } from '@/harnesses/codex-cli/hook-policy';
import { hookCommand, hookConfig, selectProkopHook } from '@/harnesses/codex-cli/pretool-hook';

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
  expect(shell("/bin/zsh -lc 'cat .env'")).toMatchObject({ resource: 'file', action: 'read' });
  expect(shell('cat ../private.txt')).toMatchObject({ resource: 'file', action: 'read' });
  expect(shell('rm -rf ./generated')).toMatchObject({ resource: 'file', action: 'delete' });
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
  expect(selectProkopHook(list(entry), 'untrusted').currentHash).toBe(hash);
  expect(selectProkopHook(list({ ...entry, trustStatus: 'trusted' }), 'trusted').key).toBe(entry.key);
  expect(selectProkopHook(list({ ...entry, trustStatus: 'trusted' }), 'either').key).toBe(entry.key);
  expect(() => selectProkopHook(list({ ...entry, command: 'other' }), 'either')).toThrow();
  expect(() => selectProkopHook(list(entry), 'trusted')).toThrow();
  expect(() => selectProkopHook(list({ ...entry, source: 'user' }), 'untrusted')).toThrow();
  expect(() => selectProkopHook({ data: [{ hooks: [entry], errors: ['invalid'] }] }, 'untrusted')).toThrow();
});
