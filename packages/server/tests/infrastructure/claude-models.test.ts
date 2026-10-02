import { expect, test } from 'bun:test';
import { listClaudeModels } from '@/harnesses/claude-cli/models';
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

test('newer CLI catalogs ship full display names with capability blurbs', async () => {
  // Real shape from Claude Code 2.1.285: display names carry the model name,
  // descriptions are pure blurbs without the ' · ' name prefix.
  const discovered = [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)',
      description: 'Opus 5.5 · Best for everyday, complex tasks',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5',
      description: 'For complex work and everyday tasks',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5',
      description: 'Most efficient for simpler tasks',
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5',
      description: 'Fastest for quick answers' },
  ];
  const models = await listClaudeModels(async () => discovered);
  expect(models.map(m => [m.model, m.name])).toEqual([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'],
  ]);
  expect(models[0]!.isDefault).toBe(true);
});

test('a default-only alias row still resolves the real model name', async () => {
  const models = await listClaudeModels(async () => [
    { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)',
      description: 'Opus 5.5 · Best for everyday, complex tasks', supportedEffortLevels: ['low', 'high'] },
  ]);
  expect(models).toEqual([
    { model: 'claude-opus-5-5', name: 'Opus 5.5', supportedEfforts: ['low', 'high'], defaultEffort: 'high', isDefault: true },
  ]);
});

test('rejects malformed CLI catalogs instead of falling back to static models', async () => {
  for (const catalog of [[], [{ ...discovered[0], resolvedModel: '--bad' }],
    [{ ...discovered[0], supportedEffortLevels: ['unknown'] }],
    [{ ...discovered[0], supportedEffortLevels: null }]]) {
    await expect(listClaudeModels(async () => catalog)).rejects.toThrow('Invalid Claude CLI model');
  }
});
