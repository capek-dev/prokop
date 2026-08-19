import type { LoadedTool } from '@capekai/tool';
import type { CapekPlugin, ToolDefinition } from '../kernel/types';

/** One agent plugin contributing the given loaded tools as visible tool
 * contributions carrying their execution payloads, in array order. This is
 * the plugin behind the former `createAgent({ tools })` option; compose it
 * directly into your agent scope's plugin list. */
export function loadedToolsPlugin(id: string, tools: readonly LoadedTool[]): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    setup(context) {
      tools.forEach((loaded, index) => {
        context.contributeTool({
          id: `${id}.${loaded.definition.name}`,
          order: 1000 + index,
          definition: loaded.definition as unknown as ToolDefinition,
          payload: loaded,
        });
      });
    },
  };
}
