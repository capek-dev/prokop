import {
  connectProvider,
  disconnectProvider,
  getConnectableProviders,
  getProviderStatus,
} from '@capekai/core/providers';
import type { ProviderRegistryPort } from '@/application/ports/provider-accounts';

/**
 * Capek provider registry adapter (S4). Wraps the process-scoped Capek
 * provider registry compat entrypoints with their exact identities; the
 * provider-account use cases consume this port, never the compat barrel.
 */
export function createJean2ProviderRegistryPort(): ProviderRegistryPort {
  return {
    list() {
      return getConnectableProviders().map((p) => ({
        ...p.descriptor,
        ...p.getStatus(),
      }));
    },
    status(providerId) {
      return getProviderStatus(providerId);
    },
    connect(providerId, options) {
      return connectProvider(providerId, options);
    },
    disconnect(providerId) {
      return disconnectProvider(providerId);
    },
  };
}
