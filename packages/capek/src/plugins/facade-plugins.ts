/**
 * Facade agent plugins. One facade agent gets its own agent scope whose
 * plugins bind the per-agent values the facade used to seed directly. Every
 * value stays owned by the agent instance, so two simultaneous facade agents
 * never share storage, configuration, host, tool source, resolver, sandbox
 * controller, or provider overrides.
 */

import type { RuntimeConfiguration } from '../configuration/contracts';
import type { ContextSources } from '../context/sources';
import type { CapekPlugin } from '../kernel/types';
import type { ConnectableProvider } from '../providers/types';
import type { RuntimeHost } from '../runtime/host';
import type { SandboxController } from '../sandbox/controller';
import type { StorageBundle } from '../storage/contracts';
import type { ToolRegistryResolver } from '../tools/registry';
import type { ToolSourceLifecycle } from '../tools/tool-source';
import { createContextSectionsPlugin } from './context-sections';
import { CODING_CAPABILITY_KEYS } from './coding-capabilities';
import { codingToolResolverPlugin } from './tool-catalog';
import {
  contextSourcesValuePlugin,
  providerOverridesValuePlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  storageValuePlugin,
  toolResolverValuePlugin,
  toolSourceValuePlugin,
} from './value-plugins';

export interface FacadeScopeValues {
  storage: StorageBundle;
  configuration: RuntimeConfiguration;
  host: RuntimeHost;
  contextSources: Partial<ContextSources>;
  toolSource: ToolSourceLifecycle;
  /** Optional compatibility resolver. When omitted, the facade
   * composition derives the resolver from the composed scope's effective
   * contributed coding tools (C4). The explicit value is the rollback
   * path and the C2 test seam. */
  toolResolver?: ToolRegistryResolver;
  /** Installed agent plugins, normally `codingAgentBundle()`. Omitted in
   * the C2 compatibility tests that compose scopes directly. */
  codingPlugins?: readonly CapekPlugin<unknown>[];
  sandboxController: SandboxController;
  providerOverrides: ReadonlyMap<string, ConnectableProvider>;
}

export const FACADE_AGENT_PLUGIN_IDS = [
  'facade.storage',
  'facade.runtime-configuration',
  'facade.runtime-host',
  'facade.context-sources',
  'facade.context-sections',
  'facade.tool-source',
  'facade.tool-resolver',
  'facade.sandbox-controller',
  'facade.provider-overrides',
] as const;

export function createFacadeAgentPlugins(values: FacadeScopeValues): readonly CapekPlugin<unknown>[] {
  return [
    storageValuePlugin('facade.storage', values.storage),
    runtimeConfigurationValuePlugin('facade.runtime-configuration', values.configuration),
    runtimeHostValuePlugin('facade.runtime-host', values.host),
    contextSourcesValuePlugin('facade.context-sources', values.contextSources),
    // Facade context parity: the facade keeps the legacy self-delegation and
    // session-search guidance sections (the C5 domain plugins own them only
    // in the current Jean2 composition), so context-sections stays at its
    // pre-C5 defaults here.
    createContextSectionsPlugin('facade.context-sections'),
    toolSourceValuePlugin('facade.tool-source', values.toolSource),
    values.toolResolver === undefined
      ? codingToolResolverPlugin('facade.tool-resolver', CODING_CAPABILITY_KEYS)
      : toolResolverValuePlugin('facade.tool-resolver', values.toolResolver),
    sandboxControllerValuePlugin('facade.sandbox-controller', values.sandboxController),
    providerOverridesValuePlugin('facade.provider-overrides', values.providerOverrides),
    ...(values.codingPlugins ?? []),
  ];
}
