/**
 * Current-composition plugins. These are functions, not constants, because
 * the host-installed objects are bound at composition time: call them after
 * the `configureX()` installation so the composed providers hold the exact
 * installed objects. Reconfiguration after composition requires recreating
 * the scope; the runtime execution path keeps reading the accessors directly
 * and is unchanged by this representation.
 */

import { getRuntimeConfiguration } from '../configuration/runtime';
import { getContextSources } from '../context/sources';
import type { CapekPlugin } from '../kernel/types';
import { getRuntimeHost } from '../runtime/host';
import { getSandboxController } from '../sandbox/controller';
import { getSchedulerHost } from '../scheduler/host';
import { getSessionSearchHost } from '../session-search/host';
import { getStorage } from '../storage/runtime';
import { getToolSource } from '../tools/tool-source';
import { CODING_CAPABILITY_PLUGIN_IDS, codingCapabilityPlugins } from './coding-capabilities';
import { createContextSectionsPlugin } from './context-sections';
import {
  contextSourcesValuePlugin,
  installedToolRegistryValuePlugin,
  providerOverridesValuePlugin,
  providerRegistryValuePlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  schedulerHostValuePlugin,
  sessionSearchHostValuePlugin,
  storageValuePlugin,
  toolSourceValuePlugin,
} from './value-plugins';

/** Plugin ids are deterministic and stable; diagnostics and tests rely on
 * them. The list mirrors the plugin construction order below. */
export const CURRENT_PROCESS_PLUGIN_IDS = [
  'current.provider-registry',
  'current.installed-tool-registry',
  'current.session-search-host',
  'current.scheduler-host',
] as const;

export const CURRENT_AGENT_PLUGIN_IDS = [
  'current.storage',
  'current.runtime-configuration',
  'current.runtime-host',
  'current.context-sources',
  'current.context-sections',
  'current.tool-source',
  'current.sandbox-controller',
  'current.provider-overrides',
  ...CODING_CAPABILITY_PLUGIN_IDS,
] as const;

/** The current agent composition installs the coding capability plugins
 * (C4) so the Jean2 composition representation exposes the exact standard
 * contributed coding inventory. It intentionally omits
 * `capek.tool-resolver` so installed-tool cache resolution runs unchanged,
 * exactly as the unseeded host path does today; production Jean2 execution
 * stays on that path until live adoption. */
export function currentAgentPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    storageValuePlugin('current.storage', getStorage()),
    runtimeConfigurationValuePlugin('current.runtime-configuration', getRuntimeConfiguration()),
    runtimeHostValuePlugin('current.runtime-host', getRuntimeHost()),
    contextSourcesValuePlugin('current.context-sources', getContextSources()),
    createContextSectionsPlugin('current.context-sections'),
    toolSourceValuePlugin('current.tool-source', getToolSource()),
    sandboxControllerValuePlugin('current.sandbox-controller', getSandboxController()),
    providerOverridesValuePlugin('current.provider-overrides', new Map()),
    ...codingCapabilityPlugins(),
  ];
}

export function currentProcessPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    providerRegistryValuePlugin('current.provider-registry'),
    installedToolRegistryValuePlugin('current.installed-tool-registry'),
    sessionSearchHostValuePlugin('current.session-search-host', getSessionSearchHost()),
    schedulerHostValuePlugin('current.scheduler-host', getSchedulerHost()),
  ];
}
