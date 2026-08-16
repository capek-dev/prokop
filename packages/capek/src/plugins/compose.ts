/**
 * C2 composition helpers. Scope creation is async (kernel activation);
 * entering a composed agent scope is fully synchronous: every service is
 * resolved and every AsyncLocalStorage accessor is seeded before the
 * callback starts, so no async work runs with unseeded accessors.
 */

import { withRuntimeConfiguration } from '../configuration/runtime';
import { setDefaultContextAssembler, withContextAssembler } from '../context/assembler';
import { withContextSources } from '../context/sources';
import { createAgentScope, createProcessScope } from '../kernel/kernel';
import type { AgentScopeHandle, ProcessScopeHandle } from '../kernel/types';
import { withProviderOverrides } from '../providers/registry';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  isDomainToolPayload,
  withContributedDomainToolPayloads,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import { withRuntimeHost } from '../runtime/host';
import { withSandboxController } from '../sandbox/controller';
import { withStorage } from '../storage/runtime';
import { withToolRegistryResolver } from '../tools/registry';
import { withToolSource } from '../tools/tool-source';
import { currentAgentPlugins, currentProcessPlugins } from './current-plugins';
import { createFacadeAgentPlugins, type FacadeScopeValues } from './facade-plugins';
import { fixedBuilderContextAssembler } from './legacy-system-message';
import {
  capekContextAssemblerKey,
  capekContextSourcesKey,
  capekProviderOverridesKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekSandboxControllerKey,
  capekStorageKey,
  capekToolResolverKey,
  capekToolSourceKey,
} from './service-keys';

export interface FacadeComposition {
  readonly processScope: ProcessScopeHandle;
  readonly agentScope: AgentScopeHandle;
}

// The ALS compatibility runtime falls back to the fixed legacy builder until
// a composed agent scope seeds its ordered assembler. Idempotent with the
// compat entrypoint installation; both bind the same byte-frozen adapter.
setDefaultContextAssembler(fixedBuilderContextAssembler);

export function createCurrentProcessScope(): Promise<ProcessScopeHandle> {
  return createProcessScope([...currentProcessPlugins()]);
}

export function createCurrentAgentScope(parent: ProcessScopeHandle): Promise<AgentScopeHandle> {
  return createAgentScope(parent, [...currentAgentPlugins()]);
}

let sharedProcessScopePromise: Promise<ProcessScopeHandle> | null = null;
let sharedScopeFactory: () => Promise<ProcessScopeHandle> = createCurrentProcessScope;

/** One lazily created current process scope shared by all facade agents. The
 * process plugins hold only process-global registries and hosts, so sharing
 * is safe; every per-agent value lives in the agent scope.
 *
 * Honest constraints:
 * - The scope is created on the first facade agent and kept for the process
 *   lifetime. Later `configureX()` calls do not refresh the hosts bound at
 *   creation; per-agent values still enter through the agent scope.
 * - Failed creation clears the cache so the next agent retries instead of
 *   inheriting a rejected scope.
 * - The facade process scope is a separate instance from Jean2 process
 *   scopes created through `createJean2RuntimeComposition()`. */
export function getSharedCurrentProcessScope(): Promise<ProcessScopeHandle> {
  if (sharedProcessScopePromise === null) {
    const promise = sharedScopeFactory();
    sharedProcessScopePromise = promise;
    void promise.catch(() => {
      if (sharedProcessScopePromise === promise) {
        sharedProcessScopePromise = null;
      }
    });
  }
  return sharedProcessScopePromise;
}

/** Test-only failure seam for the shared facade process scope. Exported from
 * this module only; no package subpath re-exports it. */
export function setSharedProcessScopeFactoryForTests(
  factory: () => Promise<ProcessScopeHandle>,
): void {
  sharedScopeFactory = factory;
}

/** Test-only reset seam for the shared facade process scope. Disposes the
 * previously cached scope (and its live child scopes) before clearing the
 * cache so tests never leak composed scopes across cases. A failed creation
 * left no scope to dispose; the cache reset alone covers that path.
 * Production lifetime semantics are untouched: the reset is exported from
 * this module only and no package subpath re-exports it. */
export async function resetSharedProcessScopeForTests(): Promise<void> {
  const pending = sharedProcessScopePromise;
  sharedScopeFactory = createCurrentProcessScope;
  sharedProcessScopePromise = null;
  if (pending === null) return;
  try {
    const scope = await pending;
    await scope.dispose();
  } catch {
    // Failed creation left no scope to dispose; the cache reset above
    // already cleared it.
  }
}

/** Composes one facade agent scope above the shared current process scope. */
export async function createFacadeAgentComposition(
  values: FacadeScopeValues,
): Promise<FacadeComposition> {
  const processScope = await getSharedCurrentProcessScope();
  const agentScope = await createAgentScope(
    processScope,
    [...createFacadeAgentPlugins(values)],
  );
  return { processScope, agentScope };
}

/**
 * Synchronously seeds every current accessor from the composed agent scope
 * and then runs the callback. Seeding order is fixed: storage, runtime
 * configuration, runtime host, context sources, provider overrides, optional
 * tool resolver, tool source, sandbox controller, context assembler. The
 * optional resolver layer is omitted when no provider contributed it,
 * exactly like the unseeded installed-tool path today. The scope's
 * assembler is bound to this scope at composition time and seeded here
 * through the context-assembler ALS runtime, so ordered context assembly
 * always resolves this exact scope, even across async suspensions and
 * interleaved scopes.
 *
 * Contributed domain tool payloads are seeded generically from the scope's
 * visible tool contributions carrying `DOMAIN_TOOL_PAYLOAD_FIELD`; an empty
 * map means a composed scope without domain payloads, which disables the
 * unscoped legacy fallbacks for the callback duration.
 */
export function enterAgentScope<T>(scope: AgentScopeHandle, callback: () => T): T {
  const storage = scope.require(capekStorageKey);
  const configuration = scope.require(capekRuntimeConfigurationKey);
  const host = scope.require(capekRuntimeHostKey);
  const contextSources = scope.require(capekContextSourcesKey);
  const providerOverrides = scope.require(capekProviderOverridesKey);
  const toolSource = scope.require(capekToolSourceKey);
  const sandboxController = scope.require(capekSandboxControllerKey);
  const toolResolver = scope.optional(capekToolResolverKey);
  const contextAssembler = scope.require(capekContextAssemblerKey);

  const domainToolPayloads = new Map<string, DomainToolPayload>();
  for (const tool of scope.listTools()) {
    if (!tool.visible) continue;
    const candidate = tool.definition[DOMAIN_TOOL_PAYLOAD_FIELD];
    if (isDomainToolPayload(candidate) && candidate.name === tool.definition.name) {
      domainToolPayloads.set(candidate.name, candidate);
    }
  }

  return withContributedDomainToolPayloads(domainToolPayloads, () =>
    withContextAssembler(contextAssembler, () =>
      withStorage(storage, () =>
        withRuntimeConfiguration(configuration, () =>
          withRuntimeHost(host, () =>
            withContextSources(contextSources, () =>
              withProviderOverrides(providerOverrides, () =>
                (toolResolver === undefined
                  ? (inner: () => T): T => withToolSource(toolSource, () =>
                    withSandboxController(sandboxController, inner))
                  : (inner: () => T): T => withToolRegistryResolver(toolResolver, () =>
                    withToolSource(toolSource, () =>
                      withSandboxController(sandboxController, inner))))(callback))))))));
}

export type {
  AgentScopeHandle,
  CapekPlugin,
  ProcessScopeHandle,
} from '../kernel/types';
