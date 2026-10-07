/**
 * Value-bound provider plugin factories. Each factory produces one plugin
 * that provides one C2 service key with the exact supplied value; the plugin
 * declares the key in `provides` so kernel validation and diagnostics see the
 * real ownership. Plugins carry no disposable resources: disposal never
 * closes storage, controllers, or hosts.
 */

import type { RuntimePlugin, ServiceKey } from '@/harnesses/prokop/composition/kernel/types';
import type { RuntimeConfiguration } from '@/infrastructure/providers/configuration/contracts';
import type { ContextSources } from '@/harnesses/prokop/context/sources';
import {
  connectProvider,
  createModelForProvider,
  disconnectProvider,
  getConnectableProviders,
  getProvider,
  getProviderStatus,
  registerProvider,
} from '@/infrastructure/providers/registry';
import type { ConnectableProvider } from '@/infrastructure/providers/types';
import type { RuntimeHost } from '@/infrastructure/runtime/host';
import type { SandboxController } from '@/infrastructure/sandbox/controller';
import type { SchedulerHost } from '@/harnesses/prokop/scheduler/host';
import type { SessionSearchHost } from '@/harnesses/shared/session-search/host';
import type { StorageBundle } from '@/infrastructure/storage/contracts';
import {
  clearCache,
  configureToolsPath,
  getTool,
  listTools,
  scanTools,
  stopWatching,
  watchTools,
  type ToolRegistryResolver,
} from '@/infrastructure/tools/registry';
import type { WorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import {
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
  type InstalledToolRegistryContract,
  type ProviderRegistryContract,
} from '@/harnesses/prokop/composition/plugins/service-keys';

function valuePlugin<T>(id: string, key: ServiceKey<T>, value: T): RuntimePlugin<unknown> {
  return {
    id,
    scope: key.scope,
    provides: [key],
    setup(context) {
      context.provide(key, value);
    },
  };
}

export function storageValuePlugin(id: string, storage: StorageBundle): RuntimePlugin<unknown> {
  return valuePlugin(id, capekStorageKey, storage);
}

export function runtimeConfigurationValuePlugin(
  id: string,
  configuration: RuntimeConfiguration,
): RuntimePlugin<unknown> {
  return valuePlugin(id, capekRuntimeConfigurationKey, configuration);
}

export function runtimeHostValuePlugin(id: string, host: RuntimeHost): RuntimePlugin<unknown> {
  return valuePlugin(id, capekRuntimeHostKey, host);
}

export function contextSourcesValuePlugin(
  id: string,
  sources: Partial<ContextSources>,
): RuntimePlugin<unknown> {
  return valuePlugin(id, capekContextSourcesKey, sources);
}

export function workspaceToolDiscoveryValuePlugin(
  id: string,
  discovery: WorkspaceToolDiscovery,
): RuntimePlugin<unknown> {
  return valuePlugin(id, capekWorkspaceToolDiscoveryKey, discovery);
}

export function toolResolverValuePlugin(id: string, resolver: ToolRegistryResolver): RuntimePlugin<unknown> {
  return valuePlugin(id, capekToolResolverKey, resolver);
}

export function sandboxControllerValuePlugin(
  id: string,
  controller: SandboxController,
): RuntimePlugin<unknown> {
  return valuePlugin(id, capekSandboxControllerKey, controller);
}

export function providerOverridesValuePlugin(
  id: string,
  overrides: ReadonlyMap<string, ConnectableProvider>,
): RuntimePlugin<unknown> {
  return valuePlugin(id, capekProviderOverridesKey, overrides);
}

/** Process-scope registry provider. Delegates to the current module
 * functions, which read the seeded per-agent overrides exactly like the
 * runtime does today. */
export function providerRegistryValuePlugin(id: string): RuntimePlugin<unknown> {
  const registry: ProviderRegistryContract = {
    registerProvider,
    getProvider,
    getConnectableProviders,
    getProviderStatus,
    connectProvider,
    disconnectProvider,
    createModelForProvider,
  };
  return valuePlugin(id, capekProviderRegistryKey, registry);
}

/** Process-scope installed tool registry provider. Delegates to the current
 * module functions, which read the seeded resolver first. */
export function installedToolRegistryValuePlugin(id: string): RuntimePlugin<unknown> {
  const registry: InstalledToolRegistryContract = {
    getTool,
    listTools,
    scanTools,
    watchTools,
    stopWatching,
    clearCache,
    configureToolsPath,
  };
  return valuePlugin(id, capekInstalledToolRegistryKey, registry);
}

export function sessionSearchHostValuePlugin(id: string, host: SessionSearchHost): RuntimePlugin<unknown> {
  return valuePlugin(id, capekSessionSearchHostKey, host);
}

export function schedulerHostValuePlugin(id: string, host: SchedulerHost): RuntimePlugin<unknown> {
  return valuePlugin(id, capekSchedulerHostKey, host);
}
