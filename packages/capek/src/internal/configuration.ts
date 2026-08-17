/**
 * Internal configuration entrypoint (`@capekai/core/internal/configuration`).
 *
 * Exposes exactly the runtime-configuration identities the Jean2 server
 * consumes through its runtime-configuration adapter: the configuration
 * accessors and the API-key resolution. Every symbol resolves to the owning
 * module's identity, identical to the compatibility barrel. S8a.
 */

export {
  configureRuntimeConfiguration,
  getApiKeyForProvider,
  getRuntimeConfiguration,
  withRuntimeConfiguration,
} from '../configuration/runtime';
export type { RuntimeConfiguration } from '../configuration/contracts';
