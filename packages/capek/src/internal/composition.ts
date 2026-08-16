/**
 * Internal package-owned composition entrypoint (`@capekai/core/internal/composition`).
 *
 * Narrow by design: only the current-scope composition helpers, their
 * service keys, and the scope handle types are exported. This is not a
 * public authoring surface; C9 decides whether a stable plugin entrypoint
 * ever exists. The package root intentionally does not re-export anything
 * from here.
 */

export {
  createCurrentAgentScope,
  createCurrentProcessScope,
  enterAgentScope,
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
  capekToolSourceKey,
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
