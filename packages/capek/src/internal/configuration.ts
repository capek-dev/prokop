/**
 * Public configuration entrypoint (`@capekai/core/configuration`).
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
export { createDefaultRuntimeConfiguration } from '../configuration/defaults';
export {
  createSingleModelConfiguration,
  resolveModelSpecifier,
  type ModelSpecifierSelection,
} from '../configuration/single-model';
