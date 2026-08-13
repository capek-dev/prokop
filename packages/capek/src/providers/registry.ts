import type { ProviderStatus } from '@jean2/sdk';
import type {
  ConnectableProvider,
  ConnectOptions,
  ConnectResult,
  ModelFactoryOptions,
  ModelFactoryResult,
} from './types';

const providers = new Map<string, ConnectableProvider>();

export function registerProvider(provider: ConnectableProvider): void {
  providers.set(provider.descriptor.id, provider);
}

export function getConnectableProviders(): ConnectableProvider[] {
  return Array.from(providers.values());
}

export function getProvider(id: string): ConnectableProvider | undefined {
  return providers.get(id);
}

export function getProviderStatus(id: string): ProviderStatus {
  return providers.get(id)?.getStatus() ?? { provider: id, connected: false };
}

export async function connectProvider(id: string, options?: ConnectOptions): Promise<ConnectResult> {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Unknown connectable provider: ${id}`);
  return provider.connect(options);
}

export async function disconnectProvider(id: string): Promise<void> {
  const provider = providers.get(id);
  if (!provider) throw new Error(`Unknown connectable provider: ${id}`);
  await provider.disconnect();
}

export async function createModelForProvider(options: ModelFactoryOptions): Promise<ModelFactoryResult> {
  const provider = providers.get(options.providerId);
  if (!provider) throw new Error(`Unknown connectable provider: ${options.providerId}`);
  if (!provider.createModel) {
    throw new Error(`Provider '${options.providerId}' does not support creating models (kind: 'service')`);
  }
  return provider.createModel(options);
}

export function resetProviders(): void {
  providers.clear();
}
