/**
 * C2 service keys for the current configurable seams. Each key wraps the
 * existing contract without inventing a new abstraction: the contract types
 * below are the current module surfaces, and the ownership record lives in
 * .architecture-v2/10-current-inventory.md ("C2 provider ownership and scope
 * record"). Ownership rules:
 *
 * - Values that differ across simultaneous facade agents are agent-scoped.
 * - Values that are process-global today (registries, host-installed search
 *   and scheduler) are process-scoped.
 * - No current seam is run-scoped; run services belong to C7.
 */

import { serviceKey } from '../kernel/service-key';
import type { ProviderStatus } from '@jean2/sdk';
import type { LoadedTool, ToolDefinition } from '@jean2/sdk';
import type { RuntimeConfiguration } from '../configuration/contracts';
import type { ContextSources } from '../context/sources';
import type { ContextAssembler } from '../context/assembler';
export type { ContextAssembler, ContextAssemblyData } from '../context/assembler';
import type { ConnectableProvider, ConnectOptions, ConnectResult, ModelFactoryOptions, ModelFactoryResult } from '../providers/types';
import type { RuntimeHost } from '../runtime/host';
import type { SandboxController } from '../sandbox/controller';
import type { SchedulerHost } from '../scheduler/host';
import type { SessionSearchHost } from '../session-search/host';
import type { StorageBundle } from '../storage/contracts';
import type { ToolRegistryResolver } from '../tools/registry';
import type { ToolSourceLifecycle } from '../tools/tool-source';

/** Current `providers/registry.ts` surface. `createModelForProvider` is the
 * model factory seam; a separate model-service contract is a C7 concern. */
export interface ProviderRegistryContract {
  registerProvider(provider: ConnectableProvider): void;
  getProvider(id: string): ConnectableProvider | undefined;
  getConnectableProviders(): ConnectableProvider[];
  getProviderStatus(id: string): ProviderStatus;
  connectProvider(id: string, options?: ConnectOptions): Promise<ConnectResult>;
  disconnectProvider(id: string): Promise<void>;
  createModelForProvider(options: ModelFactoryOptions): Promise<ModelFactoryResult>;
}

/** Current `tools/registry.ts` surface. `getTool` and `listTools` read the
 * seeded resolver first, exactly like the module functions they delegate to. */
export interface InstalledToolRegistryContract {
  getTool(name: string): Promise<LoadedTool | null>;
  listTools(): Promise<ToolDefinition[]>;
  scanTools(toolsPath?: string | null): Promise<LoadedTool[]>;
  watchTools(toolsPath?: string | null): void;
  stopWatching(): void;
  clearCache(): void;
  configureToolsPath(path?: string): void;
}

// Process scope: process-global registries and hosts.

export const capekProviderRegistryKey = serviceKey<ProviderRegistryContract>(
  'capek.provider-registry',
  'process',
);

export const capekInstalledToolRegistryKey = serviceKey<InstalledToolRegistryContract>(
  'capek.installed-tool-registry',
  'process',
);

export const capekSessionSearchHostKey = serviceKey<SessionSearchHost>(
  'capek.session-search-host',
  'process',
);

export const capekSchedulerHostKey = serviceKey<SchedulerHost>(
  'capek.scheduler-host',
  'process',
);

// Agent scope: per-agent values. A facade agent and a host agent must be able
// to run simultaneously with different values, so none of these may be
// process-scoped.

export const capekStorageKey = serviceKey<StorageBundle>('capek.storage', 'agent');

export const capekRuntimeConfigurationKey = serviceKey<RuntimeConfiguration>(
  'capek.runtime-configuration',
  'agent',
);

export const capekRuntimeHostKey = serviceKey<RuntimeHost>('capek.runtime-host', 'agent');

/** The facade passes `{}` (module defaults) exactly as today; the current
 * composition passes the full active source set. */
export const capekContextSourcesKey = serviceKey<Partial<ContextSources>>(
  'capek.context-sources',
  'agent',
);

export const capekToolSourceKey = serviceKey<ToolSourceLifecycle>('capek.tool-source', 'agent');

/** Optional by design: only the facade composition provides it. The current
 * composition omits it so installed-tool cache resolution runs unchanged. */
export const capekToolResolverKey = serviceKey<ToolRegistryResolver>(
  'capek.tool-resolver',
  'agent',
);

export const capekSandboxControllerKey = serviceKey<SandboxController>(
  'capek.sandbox-controller',
  'agent',
);

/** Seeding an empty map is behaviorally identical to today's unseeded host
 * path: both fall through to the process-wide provider registry. */
export const capekProviderOverridesKey = serviceKey<ReadonlyMap<string, ConnectableProvider>>(
  'capek.provider-overrides',
  'agent',
);

/** Ordered context assembly is a required agent service in C3. The facade and
 * current compositions both provide it through their context-sections plugin;
 * the runtime core resolves it through `getContextAssembler()`. */
export const capekContextAssemblerKey = serviceKey<ContextAssembler>(
  'capek.context-assembler',
  'agent',
);

/** Every required service key in the C2 inventory. */
export const C2_SERVICE_KEYS = [
  capekStorageKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekContextSourcesKey,
  capekToolSourceKey,
  capekToolResolverKey,
  capekSandboxControllerKey,
  capekProviderOverridesKey,
  capekContextAssemblerKey,
  capekProviderRegistryKey,
  capekInstalledToolRegistryKey,
  capekSessionSearchHostKey,
  capekSchedulerHostKey,
] as const;

/** Keys a composed agent scope must resolve before seeding accessors. */
export const C2_REQUIRED_AGENT_KEYS = [
  capekStorageKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekContextSourcesKey,
  capekToolSourceKey,
  capekSandboxControllerKey,
  capekProviderOverridesKey,
  capekContextAssemblerKey,
] as const;

export const C2_PROCESS_KEYS = [
  capekProviderRegistryKey,
  capekInstalledToolRegistryKey,
  capekSessionSearchHostKey,
  capekSchedulerHostKey,
] as const;
