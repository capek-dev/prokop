import { expect, test } from 'bun:test';
import { capekToolResolverKey, createAgentScope, createProcessScope } from '@capekai/core/composition';
import { loadedToolsPlugin } from '@capekai/core/plugins';
import type { ToolContext, ToolDefinition } from '@capekai/tool';
import { createLearningToolsPlugins, type LearningToolsOptions } from '@/adapters/capek/learning-tools';

const definitions: ToolDefinition[] = ['memory', 'agent_memory', 'skill_manage', 'agent_skill_manage', 'session_search'].map(name => ({
  name, description: name, inputSchema: { type: 'object', properties: {} },
}));

function options(overrides: Partial<LearningToolsOptions> = {}): LearningToolsOptions {
  return {
    sessionId: 'review', scope: 'workspace', improveSkills: true, definitions,
    knowledge: async name => ({ success: true, result: name }),
    search: async () => ({ success: true, result: 'filtered' }),
    ...overrides,
  };
}

for (const scope of ['workspace', 'agent'] as const) {
  test(`public plugin composition exposes only ${scope} learning tools`, async () => {
    const process = await createProcessScope([]);
    const agent = await createAgentScope(process, [
      loadedToolsPlugin('unrelated', [{ definition: { name: 'shell', description: 'No', inputSchema: {} }, path: 'test', execute: async () => ({ success: true }) }]),
      ...createLearningToolsPlugins(options({ scope })),
    ]);
    try {
      const resolver = agent.require(capekToolResolverKey);
      expect(resolver.list().map(tool => tool.definition.name).sort()).toEqual(
        (scope === 'workspace' ? ['memory', 'session_search', 'skill_manage'] : ['agent_memory', 'agent_skill_manage', 'session_search']).sort(),
      );
      expect(resolver.get('shell')).toBeNull();
      expect(resolver.get('scheduler')).toBeNull();
      const tool = resolver.get('session_search')!;
      const context = { sessionId: 'review', abortSignal: new AbortController().signal } as ToolContext;
      expect(await tool.execute({}, context)).toEqual({ success: true, result: 'filtered' });
      expect((await tool.execute({}, { ...context, sessionId: 'foreground' })).success).toBe(false);
      expect((await tool.execute({}, { ...context, abortSignal: AbortSignal.abort() })).success).toBe(false);
    } finally {
      await agent.dispose();
      await process.dispose();
    }
  });
}

test('optional skill tools are absent and missing catalog definitions fail closed', async () => {
  const process = await createProcessScope([]);
  const agent = await createAgentScope(process, [...createLearningToolsPlugins(options({ improveSkills: false }))]);
  try {
    expect(agent.require(capekToolResolverKey).get('skill_manage')).toBeNull();
    expect(() => createLearningToolsPlugins(options({ definitions: [] }))).toThrow('Missing');
    expect(() => createLearningToolsPlugins(options({ definitions: [...definitions, definitions[0]!] }))).toThrow('ambiguous');
  } finally {
    await agent.dispose();
    await process.dispose();
  }
});
