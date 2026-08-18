/**
 * C4 contributed tool catalog.
 *
 * Joins the effective tool contributions of a scope with the coding
 * capability services that carry the current `LoadedTool` payloads. The
 * resulting resolver is the C4 replacement for the hardcoded
 * `getStandardTool`/`listStandardTools` facade wiring: it consumes the
 * deterministic kernel-ordered, service-derived effective tool list and
 * re-attaches each contributed definition to its executor and builtin
 * path by identity.
 */

import type { LoadedTool } from '@capekai/tool';
import type { CapekPlugin, EffectiveTool, PluginContext, ServiceKey } from '../kernel/types';
import type { ToolRegistryResolver } from '../tools/registry';
import {
  CODING_CAPABILITY_KEYS,
  type CodingCapabilityService,
} from './coding-capabilities';
import { capekToolResolverKey } from './service-keys';

/** The narrow surface a contributed resolver reads: effective tools plus
 * optional service resolution. `ScopeHandle` and `PluginContext` both
 * satisfy it. */
export interface ContributedToolScope {
  listTools(): readonly EffectiveTool[];
  optional<T>(key: ServiceKey<T>): T | undefined;
}

function collectServiceTools(
  scope: ContributedToolScope,
  keys: readonly ServiceKey<CodingCapabilityService>[],
): Map<string, Map<string, LoadedTool>> {
  const services = new Map<string, Map<string, LoadedTool>>();
  for (const key of keys) {
    const byName = new Map<string, LoadedTool>();
    const service = scope.optional(key);
    for (const loaded of service?.tools ?? []) {
      byName.set(loaded.definition.name, loaded);
    }
    services.set(key.id, byName);
  }
  return services;
}

/** Builds a `ToolRegistryResolver` from the scope's effective visible tool
 * contributions. Hidden tools (explicitly hidden or missing a required
 * capability service) are omitted, exactly like the kernel's effective
 * visibility decision. Order follows the deterministic kernel tool order,
 * which for the coding bundle reproduces the current standard tool
 * insertion order. */
export function createContributedToolResolver(
  scope: ContributedToolScope,
  keys: readonly ServiceKey<CodingCapabilityService>[] = CODING_CAPABILITY_KEYS,
): ToolRegistryResolver {
  const services = collectServiceTools(scope, keys);
  const loaded: LoadedTool[] = [];
  for (const tool of scope.listTools()) {
    if (!tool.visible) continue;
    for (const key of keys) {
      const candidate = services.get(key.id)?.get(tool.definition.name);
      if (candidate !== undefined) {
        loaded.push(candidate);
        break;
      }
    }
  }
  const byName = new Map(loaded.map((entry) => [entry.definition.name, entry]));
  return {
    get(name: string): LoadedTool | null {
      return byName.get(name) ?? null;
    },
    list(): LoadedTool[] {
      return [...loaded];
    },
  };
}

/** Agent plugin that provides `capek.tool-resolver` with a resolver built
 * from this scope's effective contributed coding tools. It declares the
 * coding capability keys as optional dependencies: the kernel activation
 * plan orders every present capability provider before this plugin (so its
 * contributions are registered before the resolver reads them through the
 * narrow `PluginContext.listTools` surface) while absent capabilities
 * remain valid, yielding zero or partial tools for minimal and partial
 * profiles. The resolver stays bound to the owning scope. */
export function codingToolResolverPlugin(
  id: string,
  keys: readonly ServiceKey<CodingCapabilityService>[] = CODING_CAPABILITY_KEYS,
): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekToolResolverKey],
    optional: [...keys],
    setup(context: PluginContext) {
      context.provide(capekToolResolverKey, createContributedToolResolver(context, keys));
    },
  };
}
