/**
 * Public providers entrypoint (`@capekai/core/providers`).
 *
 * Exposes exactly the provider-registry identities the Jean2 server
 * consumes: registration, lookup, status, connect/disconnect, model
 * factories, and the AI SDK model adapters (title generation, OpenAI
 * Responses construction, capability tool conversion). Every symbol
 * resolves to the owning module's identity, identical to the
 * compatibility barrel. S8a.
 */

export {
  connectProvider,
  createModelForProvider,
  disconnectProvider,
  getConnectableProviders,
  getProvider,
  getProviderStatus,
  registerProvider,
  withProviderOverrides,
} from '../providers/registry';
export type { ConnectableProvider } from '../providers/types';
export type { TokenResponse } from '../providers/types';
export type { ModelFactoryOptions } from '../providers/types';
export {
  createCapabilityTool,
  createOpenAiResponsesModel,
  runTextModel,
  type CapabilityTool,
} from '../adapters/ai-sdk';
export { findProviderFromModel } from '../core/provider-utils';
export { executeChildSession } from '../subagent/child-session';
