/**
 * C2 composition helpers. Scope creation is async (kernel activation);
 * entering a composed agent scope is fully synchronous: every service is
 * resolved and every AsyncLocalStorage accessor is seeded before the
 * callback starts, so no async work runs with unseeded accessors.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRuntimeConfiguration } from '../configuration/runtime';
import { withContextAssembler } from '../context/assembler';
import { withContextSources } from '../context/sources';
import { withRetryPolicy } from '../retry/policy';
import { withCompactionService } from '../compaction/policy';
import { withAskPermissionPolicy } from '../permission/policy';
import { withPermissionRuntimeService } from '../permission/runtime';
import { withWorkspaceService } from '../workspace/policy';
import { withToolOutputService } from '../tool-output/policy';
import { withGoalDomain } from '../goals/service';
import { createAgentScope } from '../kernel/kernel';
export { createAgentScope, createProcessScope } from '../kernel/kernel';
import type { AgentScopeHandle, ProcessScopeHandle } from '../kernel/types';
import { withProviderOverrides } from '../providers/registry';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  isDomainToolPayload,
  withContributedDomainToolPayloads,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import { withRuntimeHost, getRuntimeHost, type RuntimeHost } from '../runtime/host';
import { createStandaloneHost } from '../runtime/standalone-host';
import { withSandboxController } from '../sandbox/controller';
import { withStorage } from '../storage/runtime';
import { withToolRegistryResolver } from '../tools/registry';
import { withWorkspaceToolDiscovery } from '../tools/tool-source';
import { createFacadeAgentPlugins, type FacadeScopeValues } from './facade-plugins';
export { facadeProcessPlugins } from './facade-plugins';
import { capekGoalDomainKey } from './goal-domain';
import {
  capekContextAssemblerKey,
  capekContextSourcesKey,
  capekProviderOverridesKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekRetryPolicyKey,
  capekCompactionServiceKey,
  capekPermissionPolicyKey,
  capekPermissionRuntimeKey,
  capekWorkspacePolicyKey,
  capekToolOutputPolicyKey,
  capekSandboxControllerKey,
  capekStorageKey,
  capekToolResolverKey,
  capekWorkspaceToolDiscoveryKey,
} from './service-keys';

export interface Composition {
  readonly processScope: ProcessScopeHandle;
  readonly agentScope: AgentScopeHandle;
}

/** Composes one agent scope above an explicit process scope using the
 * package's curated plugin set. The C6 policy providers read the ambient
 * runtime host (tool-output temp root) at activation, so composition runs
 * inside `withRuntimeHost`; when no host is configured ambiently, the
 * reference standalone host is installed for the composition's duration.
 * The caller owns both scopes' lifetimes:
 * `await composition.agentScope.dispose()` and
 * `await composition.processScope.dispose()` when done. Multiple agent
 * scopes may share one process scope concurrently. */
export async function createComposition(
  processScope: ProcessScopeHandle,
  values: FacadeScopeValues,
): Promise<Composition> {
  let ambient: RuntimeHost | undefined;
  try {
    ambient = getRuntimeHost();
  } catch {
    // No ambient host configured; the reference standalone host covers
    // composition-time activation reads (tool-output temp root).
    ambient = undefined;
  }
  return withRuntimeHost(ambient ?? createStandaloneHost({
    workspace: process.cwd(),
    sandboxActive: false,
    tempRoot: join(tmpdir(), 'capek-composition'),
  }), () =>
    createAgentScope(
      processScope,
      [...createFacadeAgentPlugins(values)],
    ).then((agentScope): Composition => ({ processScope, agentScope })));
}

/**
 * Synchronously seeds every current accessor from the composed agent scope
 * and then runs the callback. Seeding order is fixed: storage, runtime
 * configuration, runtime host, context sources, provider overrides, optional
 * tool resolver, tool source, sandbox controller, context assembler. The
 * optional resolver layer is omitted when no plugin contributed it,
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
  const retryPolicy = scope.require(capekRetryPolicyKey);
  const compactionService = scope.require(capekCompactionServiceKey);
  const permissionPolicy = scope.require(capekPermissionPolicyKey);
  const permissionRuntime = scope.require(capekPermissionRuntimeKey);
  const workspacePolicy = scope.require(capekWorkspacePolicyKey);
  const toolOutputPolicy = scope.require(capekToolOutputPolicyKey);
  const contextSources = scope.require(capekContextSourcesKey);
  const providerOverrides = scope.require(capekProviderOverridesKey);
  const workspaceToolDiscovery = scope.require(capekWorkspaceToolDiscoveryKey);
  const sandboxController = scope.require(capekSandboxControllerKey);
  const toolResolver = scope.optional(capekToolResolverKey);
  const contextAssembler = scope.require(capekContextAssemblerKey);
  const goalDomain = scope.optional(capekGoalDomainKey);

  const domainToolPayloads = new Map<string, DomainToolPayload>();
  for (const tool of scope.listTools()) {
    if (!tool.visible) continue;
    const candidate = tool.definition[DOMAIN_TOOL_PAYLOAD_FIELD];
    if (isDomainToolPayload(candidate) && candidate.name === tool.definition.name) {
      domainToolPayloads.set(candidate.name, candidate);
    }
  }

  const resolveTools = toolResolver === undefined
    ? (inner: () => T): T => withWorkspaceToolDiscovery(workspaceToolDiscovery, () =>
      withSandboxController(sandboxController, inner))
    : (inner: () => T): T => withToolRegistryResolver(toolResolver, () =>
      withWorkspaceToolDiscovery(workspaceToolDiscovery, () =>
        withSandboxController(sandboxController, inner)));

  const resolveGoalDomain = goalDomain === undefined
    ? (inner: () => T): T => inner()
    : (inner: () => T): T => withGoalDomain(goalDomain, inner);

  return withContributedDomainToolPayloads(domainToolPayloads, () =>
    resolveGoalDomain(() =>
      withContextAssembler(contextAssembler, () =>
        withRetryPolicy(retryPolicy, () =>
          withCompactionService(compactionService, () =>
            withAskPermissionPolicy(permissionPolicy, () =>
              withPermissionRuntimeService(permissionRuntime, () =>
                withWorkspaceService(workspacePolicy, () =>
                  withToolOutputService(toolOutputPolicy, () =>
                    withStorage(storage, () =>
                      withRuntimeConfiguration(configuration, () =>
                        withRuntimeHost(host, () =>
                          withContextSources(contextSources, () =>
                            withProviderOverrides(providerOverrides, () =>
                              resolveTools(callback)))))))))))))));
}

export type {
  AgentScopeHandle,
  CapekPlugin,
  ProcessScopeHandle,
  ToolDefinition,
} from '../kernel/types';
