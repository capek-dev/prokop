/**
 * Static composition planning. Before any plugin setup runs, the kernel
 * validates scope placement, declared services, overrides, and dependency
 * edges, then derives a deterministic activation order from the dependency
 * graph with plugin-id tie-breaks. Cycles are reported with plugin and
 * service identifiers.
 */

import {
  DependencyCycleError,
  DuplicatePluginError,
  DuplicateProviderError,
  InvalidOverrideError,
  MalformedPluginError,
  MissingDependencyError,
  ScopeValidationError,
  ServiceCollisionError,
} from './errors';
import type {
  CapekPlugin,
  RuntimeScope,
  ServiceKey,
  ServiceOverride,
} from './types';

export interface PluginDeclaration {
  readonly id: string;
  readonly version?: string;
  readonly scope: RuntimeScope;
  readonly provides: readonly ServiceKey<unknown>[];
  readonly requires: readonly ServiceKey<unknown>[];
  readonly optional: readonly ServiceKey<unknown>[];
  readonly overrides: readonly ServiceOverride[];
}

export interface ParentServiceInfo {
  readonly pluginId: string;
  readonly keyScope: RuntimeScope;
  readonly providerScope: RuntimeScope;
}

export interface ActivationEdge {
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

export interface ActivationPlan {
  readonly order: readonly string[];
  readonly edges: readonly ActivationEdge[];
}

const RESOLVABLE_SCOPES: Record<RuntimeScope, readonly RuntimeScope[]> = {
  process: ['process'],
  agent: ['agent', 'process'],
  run: ['run', 'agent', 'process'],
};

const VALID_KEY_SCOPES: ReadonlySet<string> = new Set(['process', 'agent', 'run']);

interface ProviderEntry {
  readonly declaration: PluginDeclaration;
  readonly key: ServiceKey<unknown>;
  readonly override: ServiceOverride | undefined;
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function validatePluginShape(plugin: unknown, scopeKind: RuntimeScope): asserts plugin is CapekPlugin<unknown> {
  if (typeof plugin !== 'object' || plugin === null) {
    throw new MalformedPluginError('plugin entries must be objects');
  }
  const candidate = plugin as Partial<CapekPlugin<unknown>>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new MalformedPluginError('plugin id must be a non-empty string');
  }
  if (typeof candidate.setup !== 'function') {
    throw new MalformedPluginError(`plugin '${candidate.id}' must provide a setup function`);
  }
  if (candidate.scope !== scopeKind) {
    throw new ScopeValidationError(
      `plugin '${candidate.id}' is declared for the '${String(candidate.scope)}' scope but is being installed into a '${scopeKind}' scope`,
    );
  }
}

function validateKeyShape(
  pluginId: string,
  field: string,
  key: unknown,
): asserts key is ServiceKey<unknown> {
  if (typeof key !== 'object' || key === null) {
    throw new MalformedPluginError(`plugin '${pluginId}' ${field} contains a non-object service key`);
  }
  const candidate = key as Partial<ServiceKey<unknown>>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new MalformedPluginError(
      `plugin '${pluginId}' ${field} contains a service key with a non-string or empty id`,
    );
  }
  if (!VALID_KEY_SCOPES.has(candidate.scope as string)) {
    throw new MalformedPluginError(
      `plugin '${pluginId}' ${field} contains service key '${candidate.id}' with invalid scope '${String(candidate.scope)}'`,
    );
  }
}

function validateKeyList(
  pluginId: string,
  field: 'provides' | 'requires' | 'optional',
  value: unknown,
): readonly ServiceKey<unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new MalformedPluginError(`plugin '${pluginId}' ${field} must be an array of service keys`);
  }
  for (const key of value) {
    validateKeyShape(pluginId, field, key);
  }
  return value;
}

function validateOverrideList(pluginId: string, value: unknown): readonly ServiceOverride[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new MalformedPluginError(`plugin '${pluginId}' overrides must be an array`);
  }
  const seenKeyIds = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      throw new MalformedPluginError(`plugin '${pluginId}' overrides contains a non-object entry`);
    }
    const candidate = entry as { key?: unknown; replacedProvider?: unknown };
    validateKeyShape(pluginId, 'overrides', candidate.key);
    if (typeof candidate.replacedProvider !== 'string' || candidate.replacedProvider.length === 0) {
      throw new MalformedPluginError(
        `plugin '${pluginId}' override for service '${(candidate.key as ServiceKey<unknown>).id}' must name a non-empty replacedProvider`,
      );
    }
    const keyId = (candidate.key as ServiceKey<unknown>).id;
    if (seenKeyIds.has(keyId)) {
      throw new MalformedPluginError(
        `plugin '${pluginId}' declares more than one override for service '${keyId}'`,
      );
    }
    seenKeyIds.add(keyId);
  }
  return value as readonly ServiceOverride[];
}

function validateProvidedKey(
  plugin: CapekPlugin<unknown>,
  key: ServiceKey<unknown>,
  parentServices: ReadonlyMap<string, ParentServiceInfo>,
): void {
  if (key.scope !== plugin.scope) {
    throw new ScopeValidationError(
      `plugin '${plugin.id}' (${plugin.scope}) cannot provide service '${key.id}' with scope '${key.scope}'`,
    );
  }
  const parentProvider = parentServices.get(key.id);
  if (parentProvider !== undefined) {
    throw new ServiceCollisionError(
      `plugin '${plugin.id}' cannot provide service '${key.id}': already provided by plugin '${parentProvider.pluginId}' in the '${parentProvider.providerScope}' scope; child scopes do not replace parent services`,
    );
  }
}

function validateDependencyKey(
  plugin: CapekPlugin<unknown>,
  key: ServiceKey<unknown>,
  kind: 'require' | 'optional',
): void {
  if (!RESOLVABLE_SCOPES[plugin.scope].includes(key.scope)) {
    throw new ScopeValidationError(
      `plugin '${plugin.id}' (${plugin.scope}) cannot ${kind} service '${key.id}' with scope '${key.scope}': services must be resolvable from the current or a parent scope`,
    );
  }
}

function validateOverride(
  declaration: PluginDeclaration,
  override: ServiceOverride,
  declarationsById: ReadonlyMap<string, PluginDeclaration>,
): void {
  const keyId = override.key.id;
  if (override.key.scope !== declaration.scope) {
    throw new ScopeValidationError(
      `plugin '${declaration.id}' (${declaration.scope}) cannot override service '${keyId}' with scope '${override.key.scope}': an override must target a service of its own scope`,
    );
  }
  if (!declaration.provides.some((key) => key.id === keyId)) {
    throw new InvalidOverrideError(
      `plugin '${declaration.id}' declares an override for service '${keyId}' but does not declare it in provides`,
    );
  }
  if (override.replacedProvider === declaration.id) {
    throw new InvalidOverrideError(
      `plugin '${declaration.id}' overrides service '${keyId}' naming itself as the replaced provider`,
    );
  }
  const replaced = declarationsById.get(override.replacedProvider);
  if (replaced === undefined) {
    throw new InvalidOverrideError(
      `plugin '${declaration.id}' overrides service '${keyId}' naming plugin '${override.replacedProvider}', which is not part of this composition`,
    );
  }
  if (!replaced.provides.some((key) => key.id === keyId)) {
    throw new InvalidOverrideError(
      `plugin '${declaration.id}' overrides service '${keyId}' naming plugin '${override.replacedProvider}', which does not provide that service`,
    );
  }
}

function buildProviderChains(
  declarations: readonly PluginDeclaration[],
): Map<string, string> {
  const providersByKey = new Map<string, ProviderEntry[]>();
  for (const declaration of declarations) {
    for (const key of declaration.provides) {
      const entries = providersByKey.get(key.id) ?? [];
      const override = declaration.overrides.find((entry) => entry.key.id === key.id);
      entries.push({ declaration, key, override });
      providersByKey.set(key.id, entries);
    }
  }

  const effectiveProviders = new Map<string, string>();
  for (const [keyId, providers] of providersByKey) {
    const bases = providers.filter((provider) => provider.override === undefined);
    if (bases.length === 0) {
      const overriders = providers.map((provider) => `'${provider.declaration.id}'`).join(', ');
      throw new InvalidOverrideError(
        `service '${keyId}' has no base provider; overrides declared by plugins ${overriders} cannot establish the service`,
      );
    }
    if (bases.length > 1) {
      const names = bases.map((provider) => `'${provider.declaration.id}'`).join(', ');
      throw new DuplicateProviderError(
        `service '${keyId}' is provided by multiple plugins: ${names}; a replacement requires an explicit override naming the provider being replaced`,
      );
    }

    let head = bases[0];
    const placed = new Set<string>([head.declaration.id]);
    while (placed.size < providers.length) {
      const candidates = providers.filter(
        (provider) => provider.override !== undefined
          && provider.override.replacedProvider === head.declaration.id
          && !placed.has(provider.declaration.id),
      );
      if (candidates.length > 1) {
        const names = candidates.map((candidate) => `'${candidate.declaration.id}'`).join(', ');
        throw new InvalidOverrideError(
          `service '${keyId}': plugins ${names} both override plugin '${head.declaration.id}'`,
        );
      }
      if (candidates.length === 0) {
        const unplaced = providers
          .filter((provider) => !placed.has(provider.declaration.id))
          .map((provider) => `'${provider.declaration.id}'`).join(', ');
        throw new InvalidOverrideError(
          `service '${keyId}': override chain is broken; plugin(s) ${unplaced} name a replaced provider that is not the effective provider '${head.declaration.id}'`,
        );
      }
      head = candidates[0];
      placed.add(head.declaration.id);
    }
    effectiveProviders.set(keyId, head.declaration.id);
  }
  return effectiveProviders;
}

function findCyclePath(
  remaining: readonly string[],
  adjacency: ReadonlyMap<string, readonly ActivationEdge[]>,
): { nodes: string[]; labels: string[] } {
  const remainingSet = new Set(remaining);
  const visited = new Set<string>();
  const stack: string[] = [];

  function walk(node: string): { nodes: string[]; labels: string[] } | null {
    if (visited.has(node)) {
      const start = stack.indexOf(node);
      if (start === -1) return null;
      const cycleNodes = [...stack.slice(start), node];
      const labels = cycleNodes.slice(0, -1).map((from, index) => {
        const to = cycleNodes[index + 1];
        return (adjacency.get(from) ?? []).find((edge) => edge.to === to)?.label ?? '';
      });
      return { nodes: cycleNodes, labels };
    }
    visited.add(node);
    stack.push(node);
    for (const edge of adjacency.get(node) ?? []) {
      if (!remainingSet.has(edge.to)) continue;
      const found = walk(edge.to);
      if (found !== null) return found;
    }
    stack.pop();
    return null;
  }

  for (const node of remaining) {
    const found = walk(node);
    if (found !== null) return found;
  }
  return { nodes: [], labels: [] };
}

function topologicalOrder(
  declarations: readonly PluginDeclaration[],
  edges: readonly ActivationEdge[],
): string[] {
  const nodeIds = declarations.map((declaration) => declaration.id);
  const adjacency = new Map<string, ActivationEdge[]>();
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const available = nodeIds.filter((id) => inDegree.get(id) === 0).sort(compareIds);
  const order: string[] = [];
  while (available.length > 0) {
    const node = available.shift() as string;
    order.push(node);
    for (const edge of adjacency.get(node) ?? []) {
      const nextDegree = (inDegree.get(edge.to) ?? 0) - 1;
      inDegree.set(edge.to, nextDegree);
      if (nextDegree === 0) {
        available.push(edge.to);
        available.sort(compareIds);
      }
    }
  }

  if (order.length < nodeIds.length) {
    const remaining = nodeIds.filter((id) => !order.includes(id));
    const cycle = findCyclePath(remaining, adjacency);
    const parts = cycle.nodes.map((id, index) => {
      const label = cycle.labels[index] ?? '';
      return label.length > 0 ? `plugin '${id}' (${label})` : `plugin '${id}'`;
    });
    throw new DependencyCycleError(`dependency cycle detected: ${parts.join(' -> ')}`);
  }
  return order;
}

/** A dependency key and its provider must carry the same ServiceKey scope.
 * Resolving through a mismatched scope would hand the wrong contract type to
 * the consumer, so the composition is rejected before setup. */
function assertMatchingProviderScope(
  declaration: PluginDeclaration,
  key: ServiceKey<unknown>,
  providerId: string,
  declarationsById: ReadonlyMap<string, PluginDeclaration>,
  kind: 'requires' | 'optional',
): void {
  const provider = declarationsById.get(providerId);
  const providerKey = provider?.provides.find((candidate) => candidate.id === key.id);
  if (providerKey === undefined || providerKey.scope !== key.scope) {
    throw new ScopeValidationError(
      `plugin '${declaration.id}' ${kind === 'requires' ? 'requires' : 'optionally requires'} service '${key.id}' declared with scope '${key.scope}' but provider plugin '${providerId}' provides it with scope '${String(providerKey?.scope)}'; conflicting ServiceKey scopes cannot satisfy the dependency`,
    );
  }
}

function assertMatchingParentScope(
  declaration: PluginDeclaration,
  key: ServiceKey<unknown>,
  parentInfo: ParentServiceInfo,
  kind: 'requires' | 'optional',
): void {
  if (parentInfo.keyScope !== key.scope) {
    throw new ScopeValidationError(
      `plugin '${declaration.id}' ${kind === 'requires' ? 'requires' : 'optionally requires'} service '${key.id}' declared with scope '${key.scope}' but parent scope plugin '${parentInfo.pluginId}' provides it with scope '${parentInfo.keyScope}'; conflicting ServiceKey scopes cannot satisfy the dependency`,
    );
  }
}

export function planActivation(
  scopeKind: RuntimeScope,
  plugins: readonly CapekPlugin<unknown>[],
  parentServices: ReadonlyMap<string, ParentServiceInfo>,
): ActivationPlan {
  if (!Array.isArray(plugins)) {
    throw new MalformedPluginError('plugins must be an array');
  }
  for (const plugin of plugins) {
    validatePluginShape(plugin, scopeKind);
  }

  const declarationsById = new Map<string, PluginDeclaration>();
  for (const plugin of plugins) {
    if (declarationsById.has(plugin.id)) {
      throw new DuplicatePluginError(
        `duplicate plugin id '${plugin.id}' in one composition`,
      );
    }
    const provides = validateKeyList(plugin.id, 'provides', plugin.provides);
    const requires = validateKeyList(plugin.id, 'requires', plugin.requires);
    const optional = validateKeyList(plugin.id, 'optional', plugin.optional);
    const overrides = validateOverrideList(plugin.id, plugin.overrides);
    const providedIds = new Set<string>();
    for (const key of provides) {
      if (providedIds.has(key.id)) {
        throw new MalformedPluginError(
          `plugin '${plugin.id}' declares service '${key.id}' more than once`,
        );
      }
      providedIds.add(key.id);
      validateProvidedKey(plugin, key, parentServices);
    }
    for (const key of requires) {
      validateDependencyKey(plugin, key, 'require');
    }
    for (const key of optional) {
      validateDependencyKey(plugin, key, 'optional');
    }
    declarationsById.set(plugin.id, {
      id: plugin.id,
      version: plugin.version,
      scope: plugin.scope,
      provides,
      requires,
      optional,
      overrides,
    });
  }

  for (const declaration of declarationsById.values()) {
    for (const override of declaration.overrides) {
      validateOverride(declaration, override, declarationsById);
    }
  }

  const declarations = [...declarationsById.values()];
  const effectiveProviders = buildProviderChains(declarations);

  const edges: ActivationEdge[] = [];
  for (const declaration of declarations) {
    for (const key of declaration.requires) {
      const providerId = effectiveProviders.get(key.id);
      if (providerId !== undefined) {
        assertMatchingProviderScope(declaration, key, providerId, declarationsById, 'requires');
        edges.push({
          from: providerId,
          to: declaration.id,
          label: `requires service '${key.id}'`,
        });
      } else if (parentServices.has(key.id)) {
        const parentInfo = parentServices.get(key.id) as ParentServiceInfo;
        assertMatchingParentScope(declaration, key, parentInfo, 'requires');
      } else {
        throw new MissingDependencyError(
          `plugin '${declaration.id}' requires service '${key.id}' (scope '${key.scope}') which is not provided in this composition or any parent scope`,
        );
      }
    }
    for (const key of declaration.optional) {
      const providerId = effectiveProviders.get(key.id);
      if (providerId !== undefined) {
        assertMatchingProviderScope(declaration, key, providerId, declarationsById, 'optional');
        edges.push({
          from: providerId,
          to: declaration.id,
          label: `optionally requires service '${key.id}'`,
        });
      } else if (parentServices.has(key.id)) {
        const parentInfo = parentServices.get(key.id) as ParentServiceInfo;
        assertMatchingParentScope(declaration, key, parentInfo, 'optional');
      }
    }
    for (const override of declaration.overrides) {
      edges.push({
        from: override.replacedProvider,
        to: declaration.id,
        label: `overrides service '${override.key.id}'`,
      });
    }
  }

  return { order: topologicalOrder(declarations, edges), edges };
}
