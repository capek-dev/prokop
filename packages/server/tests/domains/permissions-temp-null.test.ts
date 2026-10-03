import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeCommand, classifyFileOperation, decide, effectivePath } from '@/domains/permissions';
import { classifyClaudeTool } from '@/harnesses/claude-cli/tool-policy';
import { classifyCodexHook, type CodexHookCall } from '@/harnesses/codex-cli/hook-policy';

const fixtures: string[] = [];
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });
const ctx = { roots: ['/workspace', '/scratch/session'], cwd: '/workspace', home: homedir() };
const allowed = { roots: ctx.roots, readRoots: [] };
const call: CodexHookCall = { session_id: 'thread', turn_id: 'turn', tool_use_id: 'item',
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: ctx.cwd, tool_input: {} };

function findings(command: string) {
  const finding = analyzeCommand(command, ctx);
  const claude = classifyClaudeTool('Bash', { command }, ctx.cwd, allowed);
  const codex = classifyCodexHook({ ...call, tool_input: { command } }, allowed);
  if (finding.concerns.length || finding.catastrophic) {
    expect(claude?.concerns, command).toEqual(finding.concerns);
    expect(codex?.concerns, command).toEqual(finding.concerns);
    expect(claude?.catastrophic, command).toBe(finding.catastrophic);
    expect(codex?.catastrophic, command).toBe(finding.catastrophic);
  } else {
    expect(claude, command).toBeUndefined();
    expect(codex, command).toBeNull();
  }
  return finding;
}

describe.skipIf(process.platform === 'win32')('null device shell I/O across harness policies', () => {
  test('ordinary I/O is allowed without treating descriptors as paths', () => {
    for (const command of ['echo ok > /dev/null', 'echo ok 2> "/dev/null"',
      'echo ok >> /dev/null 2>&1', 'cat < /dev/null', 'cat /dev/null',
      'echo ok &> /dev/null', '> /dev/null', 'cat /scratch/session/a.txt > /dev/null']) {
      expect(decide('standard', findings(command)), command).toBe('auto');
    }
  });
  test('an exact target exception does not extend to siblings or concatenated words', () => {
    for (const command of ['echo ok > /dev/null-other', 'echo ok > "/dev/null"other',
      'cat /dev/null/child', 'cat /dev/null /outside/file', 'cat /dev/null && cat /outside/file']) {
      expect(findings(command).concerns, command).toContain('escape');
    }
  });
  test('device mutations and filesystem destruction ask even in Full access', () => {
    // Classification only: these strings must never be executed.
    for (const command of ['rm /dev/null', 'mv /workspace/file /dev/null', 'chmod 777 /dev/null',
      'echo bad > /dev/sda', 'dd if=x of=/dev/null', 'rm -rf / > /dev/null',
      `rm -rf "${homedir()}" > /dev/null`, 'rm -rf "$HOME" > /dev/null',
      'rm -rf "$(echo /)" > /dev/null', "sh -c 'rm -rf /' > /dev/null",
      'rm -rf /tmp', 'rm -rf /tmp/*', 'rm -rf /tmp/jean2', 'find /tmp -delete > /dev/null',
      `rm -rf "${tmpdir()}"`, 'rm -rf /private/tmp']) {
      expect(decide('full', findings(command)), command).toBe('ask');
    }
  });
});

test('session temp access retains escape, sensitive and destructive concerns', () => {
  expect(decide('standard', findings('cat /scratch/session/a.txt'))).toBe('auto');
  expect(decide('standard', findings('echo ok > /scratch/session/a.txt'))).toBe('auto');
  for (const command of ['cat /scratch/session-other/a.txt', 'cat /scratch/other/a.txt',
    'cat /scratch/session/../other/a.txt', 'cat "$TMPDIR/a.txt"',
    'TMPDIR=/outside; cat "$TMPDIR/a.txt"']) {
    expect(findings(command).concerns, command).toContain('escape');
  }
  expect(findings('cat /scratch/session/.env').concerns).toContain('sensitive');
  const deletion = findings('rm -rf /scratch/session/build');
  expect(deletion.concerns).toContain('destructive');
  expect(decide('standard', deletion)).toBe('ask');
  expect(decide('extended', deletion)).toBe('ask');
  expect(decide('full', deletion)).toBe('auto');
});

test('canonical temp roots permit aliases but reject symlink escape and missing descendants', () => {
  const base = mkdtempSync(join(tmpdir(), 'temp-policy-'));
  fixtures.push(base);
  const temp = join(base, 'session');
  mkdirSync(temp);
  symlinkSync(temp, join(base, 'alias'));
  symlinkSync('/outside', join(temp, 'escape'));
  const context = { ...ctx, roots: [join(base, 'alias')] };
  expect(analyzeCommand(`cat "${temp}/file"`, context).concerns).not.toContain('escape');
  expect(analyzeCommand(`cat "${temp}/escape/missing/file"`, context).concerns).toContain('escape');
  const file = (path: string) => classifyFileOperation({ operation: 'write', paths: [path], roots: context.roots })!;
  expect(file(join(temp, 'file')).finding.concerns).not.toContain('escape');
  expect(file(join(temp, 'escape/missing/file')).finding.concerns).toContain('escape');
  expect(effectivePath(join(base, 'alias'))).toBe(effectivePath(temp));
});

test('native file edits do not inherit the shell null-device exception', () => {
  expect(classifyClaudeTool('Write', { file_path: '/dev/null', content: 'x' }, ctx.cwd, allowed))
    .toMatchObject({ catastrophic: true });
  expect(classifyCodexHook({ ...call, tool_name: 'apply_patch', tool_input: {
    command: '*** Begin Patch\n*** Update File: /dev/null\n*** End Patch',
  } }, allowed)).toMatchObject({ catastrophic: true });
});
