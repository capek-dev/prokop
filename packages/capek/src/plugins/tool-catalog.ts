/**
 * Contributed tool catalog.
 *
 * Joins the effective tool contributions of a scope with the payloads
 * carried on those contributions (`ToolContribution.payload`). The resolver
 * re-attaches each contributed definition to its executor and install path
 * by identity, in the deterministic kernel tool order.
 */

import type { LoadedTool } from '@capekai/tool';
import type { CapekPlugin, EffectiveTool, PluginContext, ServiceKey } from '../kernel/types';
import type { ToolRegistryResolver } from '../tools/registry';
import { capekToolResolverKey } from './service-keys';

/** The narrow surface a contributed resolver reads: effective tools plus
 * optional service resolution. `ScopeHandle` and `PluginContext` both
 * satisfy it. */
export interface ContributedToolScope {
  listTools(): readonly EffectiveTool[];
  optional<T>(key: ServiceKey<T>): T | undefined;
}

function isLoadedToolPayload(value: unknown): value is LoadedTool {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { definition?: unknown; execute?: unknown };
  return typeof candidate.definition === 'object' && candidate.definition !== null
    && typeof candidate.execute === 'function';
}

/** Builds a `ToolRegistryResolver` from the scope's effective visible tool
 * contributions carrying payloads. Hidden tools are omitted, exactly like
 * the kernel's effective visibility decision. Order follows the
 * deterministic kernel tool order. The payload snapshot is taken lazily on
 * first use, so plugin activation order (the resolver plugin id may sort
 * before payload-contributing plugins) cannot drop contributions. */
export function createContributedToolResolver(
  scope: ContributedToolScope,
): ToolRegistryResolver {
  let loaded: LoadedTool[] | null = null;
  const byName = new Map<string, LoadedTool>();
  const ensureSnapshot = (): void => {
    if (loaded !== null) return;
    const collected: LoadedTool[] = [];
    for (const tool of scope.listTools()) {
      if (!tool.visible) continue;
      const payload = tool.payload;
      if (isLoadedToolPayload(payload) && payload.definition.name === tool.definition.name) {
        collected.push(payload);
        byName.set(payload.definition.name, payload);
      }
    }
    loaded = collected;
  };
  return {
    get(name: string): LoadedTool | null {
      ensureSnapshot();
      return byName.get(name) ?? null;
    },
    list(): LoadedTool[] {
      ensureSnapshot();
      return [...loaded!];
    },
  };
}

/** Agent plugin that provides `capek.tool-resolver` with a resolver built
 * from this scope's effective contributed tool payloads. The resolver stays
 * bound to the owning scope. */
export function contributedToolResolverPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekToolResolverKey],
    setup(context: PluginContext) {
      context.provide(capekToolResolverKey, createContributedToolResolver(context));
    },
  };
}
