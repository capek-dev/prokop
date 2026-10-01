import { expect, test } from 'bun:test';
import { createClaudeModelCatalogCache, listClaudeModels } from '@/harnesses/claude-cli/models';
import { claudeTextTurnArgs } from '@/harnesses/claude-cli/command';

const discovered = [
  { value: 'sonnet', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6',
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
  { value: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', supportedEffortLevels: ['low', 'high'] },
  { value: 'opus', resolvedModel: 'claude-opus-4-6', displayName: 'Opus', description: 'Opus 4.6 · Best for tasks',
    supportedEffortLevels: ['medium', 'high', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku',
    description: 'Haiku 4.5 · Fast' },
];

test('uses canonical installed CLI model IDs and reported effort levels, not guessed aliases', async () => {
  const models = await listClaudeModels(async () => discovered);
  expect(models).toEqual([
    { model: 'claude-sonnet-4-6', name: 'Sonnet 4.6', supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high', isDefault: true },
    { model: 'claude-opus-4-6', name: 'Opus 4.6', supportedEfforts: ['medium', 'high', 'max'],
      defaultEffort: 'high', isDefault: false },
    { model: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', supportedEfforts: ['default'],
      defaultEffort: 'default', isDefault: false },
  ]);
  expect(claudeTextTurnArgs(undefined, models[1]!.model, 'max')).toContain('claude-opus-4-6');
  expect(claudeTextTurnArgs(undefined, models[2]!.model, 'default')).not.toContain('--effort');
  expect(() => claudeTextTurnArgs(undefined, '--dangerously-skip-permissions', 'high')).toThrow('Unsupported');
});

test('rejects malformed CLI catalogs instead of falling back to static models', async () => {
  for (const catalog of [[], [{ ...discovered[0], resolvedModel: '--bad' }],
    [{ ...discovered[0], supportedEffortLevels: ['unknown'] }],
    [{ ...discovered[0], supportedEffortLevels: null }]]) {
    await expect(listClaudeModels(async () => catalog)).rejects.toThrow('Invalid Claude CLI model');
  }
});
