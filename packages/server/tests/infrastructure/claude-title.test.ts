import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeAiTitle } from '@/harnesses/claude-cli/title';

const originalConfig = process.env.CLAUDE_CONFIG_DIR;
const dirs: string[] = [];
afterEach(() => {
  if (originalConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfig;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture(lines: (nativeId: string) => Array<unknown | string>) {
  const config = mkdtempSync(join(tmpdir(), 'claude-ai-title-'));
  dirs.push(config);
  process.env.CLAUDE_CONFIG_DIR = config;
  const root = '/example/workspace';
  const nativeId = crypto.randomUUID();
  const project = join(config, 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  const text = lines(nativeId).map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n';
  writeFileSync(join(project, `${nativeId}.jsonl`), text);
  return { root, nativeId };
}

test('reads the latest ai-title Claude Code wrote for the session', async () => {
  const input = fixture(nativeId => [
    { type: 'user', sessionId: nativeId, message: { content: 'mentions "ai-title" in text' } },
    { type: 'ai-title', aiTitle: 'First title', sessionId: nativeId },
    'not json "ai-title"',
    { type: 'ai-title', aiTitle: 'Other session', sessionId: crypto.randomUUID() },
    { type: 'custom-title', customTitle: 'Old (fork)', sessionId: nativeId },
    { type: 'ai-title', aiTitle: '  Login   bug fix  ', sessionId: nativeId },
  ]);
  expect(await readClaudeAiTitle(input)).toBe('Login bug fix');
});

test('returns null without an ai-title, a transcript, or a valid native id', async () => {
  const input = fixture(nativeId => [{ type: 'custom-title', customTitle: 'Old (fork)', sessionId: nativeId }]);
  expect(await readClaudeAiTitle(input)).toBeNull();
  expect(await readClaudeAiTitle({ root: input.root, nativeId: crypto.randomUUID() })).toBeNull();
  expect(await readClaudeAiTitle({ root: input.root, nativeId: '../escape' })).toBeNull();
});
