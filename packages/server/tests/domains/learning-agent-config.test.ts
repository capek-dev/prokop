import { describe, expect, test } from 'bun:test';
import {
  agentHomeLearningSettings,
  parseAgentLearningConfig,
} from '@/domains/learning/settings';

describe('agent learning config', () => {
  test('absent or null settings mean enabled with defaults', () => {
    const expected = {
      enabled: true,
      cadence: null,
      instructions: '',
      sources: { mode: 'all' },
    } as const;
    expect(parseAgentLearningConfig(undefined)).toEqual(expected);
    expect(parseAgentLearningConfig(null)).toEqual(expected);
    expect(parseAgentLearningConfig({})).toEqual(expected);
    expect(parseAgentLearningConfig({ other: true })).toEqual(expected);
  });

  test('parses a full custom config', () => {
    expect(parseAgentLearningConfig({
      learning: {
        enabled: false,
        cadence: { idleMinutes: 5, minimumIntervalMinutes: 10, maximumPendingMinutes: 60 },
        instructions: 'Focus on tooling lessons',
        sources: { mode: 'selected', workspaceIds: ['ws-1'] },
      },
    })).toEqual({
      enabled: false,
      cadence: { idleMinutes: 5, minimumIntervalMinutes: 10, maximumPendingMinutes: 60 },
      instructions: 'Focus on tooling lessons',
      sources: { mode: 'selected', workspaceIds: ['ws-1'] },
    });
  });

  test('malformed config fails closed to null, never to enabled', () => {
    expect(parseAgentLearningConfig({ learning: { enabled: 'yes' } })).toBeNull();
    expect(parseAgentLearningConfig({ learning: { cadence: { idleMinutes: 0, minimumIntervalMinutes: 1, maximumPendingMinutes: 1 } } })).toBeNull();
    expect(parseAgentLearningConfig({ learning: { sources: { mode: 'everywhere' } } })).toBeNull();
  });

  test('the agent home settings shape uses the owning agent as single reviewer', () => {
    const config = parseAgentLearningConfig({
      learning: {
        enabled: true,
        cadence: { idleMinutes: 15, minimumIntervalMinutes: 30, maximumPendingMinutes: 120 },
        instructions: 'Prefer terse lessons',
        sources: { mode: 'selected', workspaceIds: ['ws-1', 'ws-2'] },
      },
    })!;
    expect(agentHomeLearningSettings(config, 'coder')).toEqual({
      enabled: true,
      reviewers: [{
        id: 'coder',
        preconfigId: 'coder',
        instructions: 'Prefer terse lessons',
        modelOverride: null,
        cadence: { idleMinutes: 15, minimumIntervalMinutes: 30, maximumPendingMinutes: 120 },
      }],
      improveSkills: true,
      instructions: '',
      sources: { mode: 'selected', workspaceIds: ['ws-1', 'ws-2'] },
    });
  });
});
