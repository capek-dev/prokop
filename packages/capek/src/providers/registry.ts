import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProviderStatus } from '@capekai/types';
import type {
  ConnectableProvider,
  ConnectOptions,
  ConnectResult,
  ModelFactoryOptions,
  ModelFactoryResult,
} from './types';

const providers = new Map<string, ConnectableProvider>();
const scopedProviders = new AsyncLocalStorage<ReadonlyMap<string, ConnectableProvider>>();

function activeProvider(id: string): ConnectableProvider | undefined {
  return scopedProviders.getStore()?.get(id) ?? providers.get(id);
}

export function withProviderOverrides<T>(overrides: ReadonlyMap<string, ConnectableProvider>, callback: () => T): T {
  return scopedProviders.run(overrides, callback);
}

export function registerProvider(provider: ConnectableProvider): void {
  providers.set(provider.descriptor.id, provider);
}

export function getConnectableProviders(): ConnectableProvider[] {
  const combined = new Map(providers);
  for (const [id, provider] of scopedProviders.getStore() ?? []) combined.set(id, provider);
  return [...combined.values()];
}

export function getProvider(id: string): ConnectableProvider | undefined {
  return activeProvider(id);
}

export function getProviderStatus(id: string): ProviderStatus {
  return activeProvider(id)?.getStatus() ?? { provider: id, connected: false };
}

export async function connectProvider(id: string, options?: ConnectOptions): Promise<ConnectResult> {
  const provider = activeProvider(id);
  if (!provider) throw new Error(`Unknown connectable provider: ${id}`);
  return provider.connect(options);
}

export async function disconnectProvider(id: string): Promise<void> {
  const provider = activeProvider(id);
  if (!provider) throw new Error(`Unknown connectable provider: ${id}`);
  await provider.disconnect();
}

export async function createModelForProvider(options: ModelFactoryOptions): Promise<ModelFactoryResult> {
  const provider = activeProvider(options.providerId);
  if (!provider) throw new Error(`Unknown connectable provider: ${options.providerId}`);
  if (!provider.createModel) {
    throw new Error(`Provider '${options.providerId}' does not support creating models (kind: 'service')`);
  }
  return provider.createModel(options);
}

export function resetProviders(): void {
  providers.clear();
}
