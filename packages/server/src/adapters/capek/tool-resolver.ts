/**
 * Built-in tool resolver plugin (merged catalog).
 *
 * Contributes the baked-in baseline tools and provides the agent-scope
 * tool resolver: contributed tools (built-ins, domain payloads, the
 * tool-output policy's retrieve-tool-output) win over same-named
 * installed directory tools (built-in wins; shadowed installs warn).
 *
 * The capek resolver interface is synchronous while the installed-tools
 * directory scan is async, so this module keeps the installed snapshot
 * warm: an eager warm-up at composition time plus a TTL-driven
 * background refresh on every resolve. A refresh never blocks
 * resolution; it publishes the new snapshot when it lands.
 */

import type { LoadedTool } from '@capekai/tool';
import {
  getInstalledTool as capekGetInstalledTool,
  hasUnscannedToolCache,
  listInstalledTools as capekListInstalledTools,
  scanTools,
  type ToolRegistryResolver,
} from '@capekai/core/tools';
import {
  createContributedToolResolver,
  loadedToolsPlugin,
} from '@capekai/core/plugins';
import { capekToolResolverKey, type CapekPlugin } from '@capekai/core/composition';
import { builtinTools } from '@/tools/builtin';
import { isManagedWorktreeLifecycleTool } from './tool-policy';

const REFRESH_TTL_MS = 60_000;
const exposedBuiltinTools = builtinTools.filter(
  (tool) => !isManagedWorktreeLifecycleTool(tool.definition.name),
);

let lastRefreshAt = 0;
let refreshInFlight: Promise<void> | null = null;

/** Triggers a background directory scan when the TTL expired. Never
 * throws; scan failures leave the previous snapshot in place. */
function scheduleInstalledToolsRefresh(): void {
  if (Date.now() - lastRefreshAt < REFRESH_TTL_MS) return;
  if (refreshInFlight !== null) return;
  lastRefreshAt = Date.now();
  refreshInFlight = scanTools()
    .then(() => undefined)
    .catch(() => {
      // Scan failures keep the previous snapshot; the TTL reset above
      // throttles retries.
    })
    .finally(() => {
      refreshInFlight = null;
    });
}

const warnedShadowed = new Set<string>();

function warnShadowed(installed: LoadedTool): void {
  if (warnedShadowed.has(installed.definition.name)) return;
  warnedShadowed.add(installed.definition.name);
  console.warn(
    `[prokopai] Installed tool "${installed.definition.name}" is shadowed by a built-in tool of the same name; the built-in wins. Remove the installed copy or rename the external tool.`,
  );
}

/** Merges a contributed resolver (built-ins + policy + domain payloads)
 * with the installed directory snapshot. Contributions win on name
 * collision. */
export function createMergedToolResolver(contributed: ToolRegistryResolver): ToolRegistryResolver {
  return {
    get(name: string): LoadedTool | null {
      scheduleInstalledToolsRefresh();
      if (isManagedWorktreeLifecycleTool(name)) return null;
      return contributed.get(name) ?? capekGetInstalledTool(name);
    },
    list(): LoadedTool[] {
      scheduleInstalledToolsRefresh();
      const merged = [...contributed.list()];
      const contributedNames = new Set(merged.map((tool) => tool.definition.name));
      for (const installed of capekListInstalledTools()) {
        if (isManagedWorktreeLifecycleTool(installed.definition.name)) continue;
        if (contributedNames.has(installed.definition.name)) {
          warnShadowed(installed);
          continue;
        }
        merged.push(installed);
      }
      return merged;
    },
  };
}

/** Eager warm-up so the first sync resolve already sees installed
 * tools. Safe to call repeatedly; the TTL makes it cheap. */
export async function warmInstalledToolsCache(): Promise<void> {
  if (Date.now() - lastRefreshAt < REFRESH_TTL_MS && !hasUnscannedToolCache()) return;
  lastRefreshAt = Date.now();
  await scanTools().catch(() => {
    // Failures leave the snapshot empty; later TTL refreshes retry.
  });
}

/** The built-in tools agent plugins: one plugin contributing the
 * baked-in baseline, one providing the merged resolver above the
 * scope's contributed catalog (which includes those built-ins, the
 * tool-output policy's retrieval tool, and domain tool payloads). */
export function builtinToolsAgentPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    loadedToolsPlugin('prokopai.builtin-tools', exposedBuiltinTools),
    {
      id: 'prokopai.tool-resolver',
      scope: 'agent',
      provides: [capekToolResolverKey],
      setup(context) {
        context.provide(capekToolResolverKey, createMergedToolResolver(createContributedToolResolver(context)));
      },
    },
  ];
}
