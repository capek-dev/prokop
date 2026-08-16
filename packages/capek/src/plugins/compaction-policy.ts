import type { CapekPlugin, PluginContext } from '../kernel/types';
import {
  createCompactionService,
  type CompactionServiceOptions,
} from '../compaction/policy';
import {
  capekCompactionServiceKey,
  capekRuntimeConfigurationKey,
} from './service-keys';

/**
 * C6 provider for the agent-scoped compaction service contract
 * (`capek.compaction-service`). Environment variables are translated into
 * provider options here, at composition: the plugin reads the composed
 * runtime configuration once at setup and freezes the compaction values into
 * the service options, so no runtime code reads compaction environment
 * variables directly. The default provider reproduces the exact current
 * trigger, summary, pruning, cooldown, replay, and recovery behavior.
 */
export function compactionPolicyPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekCompactionServiceKey],
    requires: [capekRuntimeConfigurationKey],
    setup(context: PluginContext) {
      const configuration = context.require(capekRuntimeConfigurationKey);
      const options: CompactionServiceOptions = {
        modelId: configuration.getCompactionModel() ?? null,
        providerId: configuration.getCompactionProvider() ?? null,
        maxOutputTokens: configuration.getCompactionMaxTokens(),
        preserveRecentToolCount: configuration.getCompactionPreserveRecentToolCount(),
        preserveSmallToolChars: configuration.getCompactionPreserveSmallToolChars(),
        toolClearCharsThreshold: configuration.getCompactionToolClearCharsThreshold(),
        maxPrunedToolCount: configuration.getCompactionMaxPrunedToolCount(),
        autoThresholdRatio: configuration.getCompactionAutoThresholdRatio(),
        autoReserveCapTokens: configuration.getCompactionAutoReserveCapTokens(),
        autoSafetyMarginTokens: configuration.getCompactionAutoSafetyMarginTokens(),
      };
      context.provide(
        capekCompactionServiceKey,
        createCompactionService({ id, options }),
      );
    },
  };
}
