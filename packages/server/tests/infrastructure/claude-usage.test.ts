import { expect, test } from 'bun:test';
import { parseClaudeUsage } from '@/harnesses/claude-cli/usage';

const row = { inputTokens: 4, outputTokens: 2, cacheReadInputTokens: 3,
  cacheCreationInputTokens: 1, costUSD: 0.01, contextWindow: 200000 };

test('does not fabricate usage from missing or malformed SDK model totals', () => {
  expect(parseClaudeUsage(undefined, 'claude-sonnet-5')).toBeNull();
  expect(parseClaudeUsage({}, 'claude-sonnet-5')).toBeNull();
  expect(parseClaudeUsage({ 'claude-sonnet-5': { ...row, inputTokens: -1 } }, 'claude-sonnet-5')).toBeNull();
  expect(parseClaudeUsage({ 'claude-sonnet-5': { ...row, cacheReadInputTokens: Infinity } }, 'claude-sonnet-5')).toBeNull();
  expect(parseClaudeUsage({ 'claude-sonnet-5': row }, 'unknown')).toMatchObject({ contextWindow: null,
    prompt: 4, cacheRead: 3, cacheWrite: 1, completion: 2 });
});
