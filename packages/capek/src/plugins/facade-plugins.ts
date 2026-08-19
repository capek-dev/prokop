/**
 * Facade agent plugins. One facade agent gets its own agent scope whose
 * plugins bind the per-agent values the facade used to seed directly. Every
 * value stays owned by the agent instance, so two simultaneous facade agents
 * never share storage, configuration, host, tool source, resolver, sandbox
 * controller, or provider overrides.
 */

import type { RuntimeConfiguration } from '../configuration/contracts';
import type { ContextSources } from '../context/sources';
import type { LoadedTool } from '@capekai/tool';
import type { CapekPlugin } from '../kernel/types';
import type { ConnectableProvider } from '../providers/types';
import type { RuntimeHost } from '../runtime/host';
import type { SandboxController } from '../sandbox/controller';
import type { StorageBundle } from '../storage/contracts';
import type { ToolRegistryResolver } from '../tools/registry';
import type { WorkspaceToolDiscovery } from '../tools/tool-source';
import { getSchedulerHost } from '../scheduler/host';
import { getSessionSearchHost } from '../session-search/host';
import { createContextSectionsPlugin } from './context-sections';
import { loadedToolsPlugin } from './loaded-tools';
import { retryPolicyPlugin } from './retry-policy';
import { compactionPolicyPlugin } from './compaction-policy';
import { permissionPolicyPlugin } from './permission-policy';
import { workspacePolicyPlugin } from './workspace-policy';
import { toolOutputPolicyPlugin } from './tool-output-policy';
import { defaultAgentDriverPlugin } from './default-agent-driver';
import { contributedToolResolverPlugin } from './tool-catalog';
import {
  contextSourcesValuePlugin,
  providerOverridesValuePlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  storageValuePlugin,
  toolResolverValuePlugin,
  workspaceToolDiscoveryValuePlugin,
  installedToolRegistryValuePlugin,
  providerRegistryValuePlugin,
  schedulerHostValuePlugin,
  sessionSearchHostValuePlugin,
} from './value-plugins';

export const FACADE_PROCESS_PLUGIN_IDS = [
  'facade.provider-registry',
  'facade.installed-tool-registry',
  'facade.session-search-host',
  'facade.scheduler-host',
] as const;

export function facadeProcessPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    providerRegistryValuePlugin('facade.provider-registry'),
    installedToolRegistryValuePlugin('facade.installed-tool-registry'),
    sessionSearchHostValuePlugin('facade.session-search-host', getSessionSearchHost()),
    schedulerHostValuePlugin('facade.scheduler-host', getSchedulerHost()),
  ];
}

export interface FacadeScopeValues {
  storage: StorageBundle;
  configuration: RuntimeConfiguration;
  host: RuntimeHost;
  contextSources: Partial<ContextSources>;
  workspaceToolDiscovery: WorkspaceToolDiscovery;
  /** Optional compatibility resolver. When omitted, the facade
   * composition derives the resolver from the composed scope's effective
   * contributed tool payloads. The explicit value is the rollback
   * path and the C2 test seam. */
  toolResolver?: ToolRegistryResolver;
  /** Host-supplied plugins appended after the facade's own (external tool
   * contributions land here). */
  profilePlugins?: readonly CapekPlugin<unknown>[];
  /** Convenience: loaded tools contributed by one generated plugin, as with
   * the former `createAgent({ tools })` option. Equivalent to passing
   * `loadedToolsPlugin('facade.loaded-tools', tools)` in profilePlugins. */
  loadedTools?: readonly LoadedTool[];
  sandboxController: SandboxController;
  providerOverrides: ReadonlyMap<string, ConnectableProvider>;
}

export const FACADE_AGENT_PLUGIN_IDS = [
  'facade.storage',
  'facade.runtime-configuration',
  'facade.runtime-host',
  'facade.agent-driver',
  'facade.retry-policy',
  'facade.compaction-policy',
  'facade.permission-policy',
  'facade.workspace-policy',
  'facade.tool-output-policy',
  'facade.context-sources',
  'facade.context-sections',
  'facade.workspace-tool-discovery',
  'facade.tool-resolver',
  'facade.sandbox-controller',
  'facade.provider-overrides',
] as const;

export function createFacadeAgentPlugins(values: FacadeScopeValues): readonly CapekPlugin<unknown>[] {
  return [
    storageValuePlugin('facade.storage', values.storage),
    runtimeConfigurationValuePlugin('facade.runtime-configuration', values.configuration),
    runtimeHostValuePlugin('facade.runtime-host', values.host),
    defaultAgentDriverPlugin('facade.agent-driver'),
    // C6: the agent scope owns the retry policy (and its circuit state)
    // instead of the facade's pre-C6 per-agent withRetryCircuitState wrap.
    retryPolicyPlugin('facade.retry-policy'),
    compactionPolicyPlugin('facade.compaction-policy'),
    permissionPolicyPlugin('facade.permission-policy'),
    workspacePolicyPlugin('facade.workspace-policy'),
    toolOutputPolicyPlugin('facade.tool-output-policy'),
    contextSourcesValuePlugin('facade.context-sources', values.contextSources),
    // Facade context parity: the facade keeps the legacy self-delegation and
    // session-search guidance sections (the C5 domain plugins own them only
    // in the current Jean2 composition), so context-sections stays at its
    // pre-C5 defaults here.
    createContextSectionsPlugin('facade.context-sections'),
    workspaceToolDiscoveryValuePlugin('facade.workspace-tool-discovery', values.workspaceToolDiscovery),
    values.toolResolver === undefined
      ? contributedToolResolverPlugin('facade.tool-resolver')
      : toolResolverValuePlugin('facade.tool-resolver', values.toolResolver),
    sandboxControllerValuePlugin('facade.sandbox-controller', values.sandboxController),
    providerOverridesValuePlugin('facade.provider-overrides', values.providerOverrides),
    ...(values.loadedTools?.length ? [loadedToolsPlugin('facade.loaded-tools', values.loadedTools)] : []),
    ...(values.profilePlugins ?? []),
  ];
}
