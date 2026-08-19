/** Public package-owned generic composition entrypoint. */

export {
  createAgentScope,
  createComposition,
  createProcessScope,
  enterAgentScope,
  facadeProcessPlugins,
  type Composition,
} from '../plugins/compose';
export type {
  AgentScopeHandle,
  CapekPlugin,
  ProcessScopeHandle,
} from '../plugins/compose';
export {
  capekAgentDriverKey,
  capekContextAssemblerKey,
  capekContextSourcesKey,
  capekInstalledToolRegistryKey,
  capekProviderOverridesKey,
  capekProviderRegistryKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekSandboxControllerKey,
  capekSchedulerHostKey,
  capekSessionSearchHostKey,
  capekStorageKey,
  capekToolResolverKey,
  capekWorkspaceToolDiscoveryKey,
} from '../plugins/service-keys';
export {
  C2_PROCESS_KEYS,
  C2_REQUIRED_AGENT_KEYS,
  C2_SERVICE_KEYS,
} from '../plugins/service-keys';
export type {
  InstalledToolRegistryContract,
  ProviderRegistryContract,
} from '../plugins/service-keys';
export type {
  ContextAssembler,
  ContextAssemblyData,
} from '../plugins/service-keys';
