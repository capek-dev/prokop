import {
  clearProviderCredential,
  listProviderCredentials,
  setProviderCredential,
} from '@/config/provider-credentials';
import type { ProviderCredentialPort } from '@/application/ports/provider-accounts';

/**
 * Jean2 provider credential adapter (S4). Wraps the configuration
 * credential implementation with its exact identities; typed configuration
 * errors propagate unchanged so the route error mapping stays identical.
 */
export function createJean2ProviderCredentialPort(): ProviderCredentialPort {
  return {
    list: listProviderCredentials,
    set: setProviderCredential,
    clear: clearProviderCredential,
  };
}
