/**
 * C4 minimal bundle.
 *
 * A minimal profile installs no coding capability plugins and therefore
 * exposes no coding tools. It proves the coding tool set is installed
 * bundle behavior rather than a runtime assumption: the same runtime
 * composes with zero tool contributions when the bundle is absent.
 */

import type { CapekPlugin } from '../kernel/types';

export const MINIMAL_AGENT_BUNDLE_PLUGIN_IDS = [] as const;

/** The minimal bundle: no plugins, no model-facing coding tools. */
export function minimalAgentBundle(): CapekPlugin<unknown>[] {
  return [];
}
