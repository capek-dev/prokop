import type { CapekPlugin } from '../kernel/types';
import {
  CURRENT_AGENT_PLUGIN_IDS,
  CURRENT_PROCESS_PLUGIN_IDS,
  currentAgentPlugins,
  currentProcessPlugins,
} from '../plugins/current-plugins';

export const JEAN2_PROFILE_ID = 'jean2-compatible' as const;
export const JEAN2_PROCESS_PLUGIN_IDS = CURRENT_PROCESS_PLUGIN_IDS;
export const JEAN2_AGENT_PLUGIN_IDS = CURRENT_AGENT_PLUGIN_IDS;

export interface Jean2Profile {
  readonly id: typeof JEAN2_PROFILE_ID;
  processPlugins(): readonly CapekPlugin<unknown>[];
  agentPlugins(): readonly CapekPlugin<unknown>[];
}

export const jean2Profile: Jean2Profile = {
  id: JEAN2_PROFILE_ID,
  processPlugins: currentProcessPlugins,
  agentPlugins: currentAgentPlugins,
};
