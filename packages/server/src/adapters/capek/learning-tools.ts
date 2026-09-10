import type { LoadedTool, ToolDefinition, ToolResult } from '@capekai/tool';
import { capekToolResolverKey, type CapekPlugin } from '@capekai/core/composition';
import { createContributedToolResolver, loadedToolsPlugin } from '@capekai/core/plugins';
import type { LearningScope } from '@prokopai/sdk';
import type { LearningKnowledgeResult } from './learning-knowledge';

export interface LearningToolsOptions {
  sessionId: string;
  scope: LearningScope;
  improveSkills: boolean;
  /** Definitions from the published catalog; never load installed executable tools. */
  definitions: readonly ToolDefinition[];
  knowledge(name: string, input: unknown): Promise<LearningKnowledgeResult>;
  search(input: Record<string, unknown>): Promise<ToolResult>;
}

/** Dedicated review composition only. Do not combine with memory/skills domain
 * plugins: these registry tools deliberately replace their execution path. */
export function createLearningToolsPlugins(options: LearningToolsOptions): readonly CapekPlugin<unknown>[] {
  const memory = options.scope === 'agent' ? 'agent_memory' : 'memory';
  const skills = options.scope === 'agent' ? 'agent_skill_manage' : 'skill_manage';
  const names = [memory, 'session_search', ...(options.improveSkills ? [skills] : [])];
  const loaded: LoadedTool[] = names.map(name => {
    const definitions = options.definitions.filter(item => item.name === name);
    if (definitions.length !== 1) throw new Error(`Missing or ambiguous learning tool definition: ${name}`);
    return {
      definition: definitions[0]!,
      path: 'prokopai:learning',
      async execute(input, context) {
        if (context.sessionId !== options.sessionId || context.abortSignal.aborted) {
          return { success: false, error: 'Learning execution context is no longer authorized' };
        }
        return name === 'session_search' ? options.search(input) : options.knowledge(name, input);
      },
    };
  });
  return [
    loadedToolsPlugin('prokopai.learning-tools', loaded),
    {
      id: 'prokopai.learning-tool-resolver',
      scope: 'agent',
      provides: [capekToolResolverKey],
      setup(context) {
        const contributed = createContributedToolResolver(context);
        const allowed = new Set(names);
        context.provide(capekToolResolverKey, {
          get: name => allowed.has(name) ? contributed.get(name) : null,
          list: () => contributed.list().filter(tool => allowed.has(tool.definition.name)),
        });
      },
    },
  ];
}
