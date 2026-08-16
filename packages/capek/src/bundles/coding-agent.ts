/**
 * C4 coding-agent bundle.
 *
 * Ordinary TypeScript composition over the canonical coding capability
 * plugins from the plugins layer. Installing this bundle is what exposes
 * the standard coding tools through deterministic kernel tool
 * contributions. The facade profile installs it; the current tool set,
 * schemas, timeouts, capabilities, builtin paths, and executors are
 * unchanged.
 */

import type { CapekPlugin } from '../kernel/types';
import {
  CODING_CAPABILITY_PLUGIN_IDS,
  codingCapabilityPlugins,
} from '../plugins/coding-capabilities';

export const CODING_AGENT_BUNDLE_PLUGIN_IDS = CODING_CAPABILITY_PLUGIN_IDS;

/** The current coding-agent bundle: filesystem, editing, search, shell,
 * question, and tool-output capability plugins over the current standard
 * tools. */
export function codingAgentBundle(): CapekPlugin<unknown>[] {
  return codingCapabilityPlugins();
}
