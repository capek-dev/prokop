import {
  configureJean2AgentSource,
  configureJean2Bindings,
  configureJean2InstructionSource,
  configureJean2PreconfigSource,
  configureJean2RuntimeConfiguration,
  configureJean2SchedulerHost,
  configureJean2SessionSearchHost,
  configureJean2Storage,
  configureJean2ToolSource,
} from '@/adapters/capek';

/**
 * Explicit Jean2 server composition root.
 *
 * This module assembles the focused Čapek adapters in the order established by
 * the legacy adapter composition. It owns ordering only; every adapter value,
 * fallback, and policy rule lives in its focused `adapters/capek` module.
 */
export function createRuntime(): void {
  configureJean2Storage();
  configureJean2RuntimeConfiguration();
  configureJean2PreconfigSource();
  configureJean2AgentSource();
  configureJean2InstructionSource();
  configureJean2SessionSearchHost();
  configureJean2SchedulerHost();
  configureJean2ToolSource();
  configureJean2Bindings();
}

/**
 * Temporary compatibility name: the old adapter entrypoint now delegates to
 * the explicit composition root. Removed when consumers migrate in S8.
 */
export function configureCapekJean2Compatibility(): void {
  createRuntime();
}

export { createJean2RuntimeComposition } from '@/adapters/capek/composition';
