/**
 * Typed service keys. Keys are frozen, compared by id, and carry a phantom
 * type so require/optional return the provider's contract type.
 */

import { MalformedPluginError } from './errors';
import type { RuntimeScope, ServiceKey } from './types';

const VALID_SCOPES = new Set<string>(['process', 'agent', 'run']);

export function serviceKey<T = unknown>(id: string, scope: RuntimeScope): ServiceKey<T> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new MalformedPluginError('service key id must be a non-empty string');
  }
  if (!VALID_SCOPES.has(scope)) {
    throw new MalformedPluginError(`service key '${id}' has invalid scope '${String(scope)}'`);
  }
  return Object.freeze({ id, scope });
}
