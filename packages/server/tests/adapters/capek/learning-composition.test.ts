import { afterEach, expect, test } from 'bun:test';
import { buildAiSdkTools } from '@capekai/core/execution';
import { getRuntimeHost } from '@capekai/core/hosts';
import { listDomainToolFallbackDefinitions } from '@capekai/core/tools';
import type { Preconfig } from '@prokopai/sdk';
import { executeLearningComposition } from '@/adapters/capek/learning-composition';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';

afterEach(resetTestDatabase);

test.each(['workspace', 'agent'] as const)('full %s composition suppresses domain fallbacks and preserves foreground host', async scope => {
  setupTestDatabase();
  seedWorkspace({ id: 'ws', settings: {
    memory: { enabled: true, permissionRisk: 'high' },
    sessionSearch: { enabled: true, permissionRisk: 'high', includeToolResults: true },
    scheduling: { enabled: true, permissionRisk: 'high' },
    skills: { managementEnabled: true, permissionRisk: 'high' },
    workflow: { enabled: true },
  } });
  seedSession('ws', { id: 'review' });
  const host = getRuntimeHost();
  let executed = false;
  const preconfig = { id: 'dev', name: 'Developer', model: 'test', provider: 'test', tools: ['shell'], canSpawnSubagents: true } as Preconfig;
  await executeLearningComposition({
    sessionId: 'review', workspaceId: 'ws', workspacePath: '/test', scope, improveSkills: false, home: async () => ({ success: true }),
    definitions: listDomainToolFallbackDefinitions(), preconfig, systemPrompt: 'Scoped policy', prompt: 'Review',
    signal: new AbortController().signal,
    knowledge: async () => ({ success: true }), search: async () => ({ success: true }),
  }, async options => {
    executed = true;
    expect(getRuntimeHost()).not.toBe(host);
    expect(options.preconfig.canSpawnSubagents).toBe(false);
    const tools = await buildAiSdkTools({
      toolNames: options.preconfig.tools!, sessionId: 'review', workspaceId: 'ws', workspacePath: '/test',
      modelId: 'test', providerId: 'test', canSpawnSubagents: false,
    });
    expect(Object.keys(tools).sort()).toEqual(scope === 'agent' ? ['agent_memory', 'home_files', 'session_search'] : ['memory', 'session_search']);
    return { parts: [] };
  });
  expect(executed).toBe(true);
  expect(getRuntimeHost()).toBe(host);
});
