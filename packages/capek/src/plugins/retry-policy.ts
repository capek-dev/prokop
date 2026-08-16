import type { CapekPlugin, PluginContext } from '../kernel/types';
import {
  createRetryPolicy,
  type RetryPolicy,
} from '../retry/policy';
import { capekRetryPolicyKey } from './service-keys';

/**
 * C6 provider for the agent-scoped retry policy contract
 * (`capek.retry-policy`). Wraps the exact current behavior through
 * `createRetryPolicy()`: classification, exponential jittered backoff with
 * Retry-After as a minimum, circuit state owned by this policy instance, and
 * the no-retry-after-tool-activity side-effect barrier. Every composed agent
 * scope gets its own policy instance, so circuit state is isolated per
 * agent; the facade's pre-C6 per-agent `withRetryCircuitState` wrap is
 * replaced by this scope-owned provider.
 */
export function retryPolicyPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekRetryPolicyKey],
    setup(context: PluginContext) {
      const policy: RetryPolicy = createRetryPolicy({ id });
      context.provide(capekRetryPolicyKey, policy);
    },
  };
}
