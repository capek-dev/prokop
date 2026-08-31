/** The Jean2 server composition profile and its exact plugin inventory. */

import type { CapekPlugin } from '@capekai/core/composition';
import {
  compactionPolicyPlugin,
  contextSourcesValuePlugin,
  createContextSectionsPlugin,
  defaultAgentDriverPlugin,
  getContextSources,
  getRuntimeConfiguration,
  getRuntimeHost,
  getSandboxController,
  getSchedulerHost,
  getSessionSearchHost,
  getStorage,
  getWorkspaceToolDiscovery,
  goalDomainPlugin,
  installedToolRegistryValuePlugin,
  memoryDomainPlugin,
  orchestratorSessionProviderPlugin,
  permissionPolicyPlugin,
  providerOverridesValuePlugin,
  providerRegistryValuePlugin,
  retryPolicyPlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  schedulerDomainPlugin,
  schedulerHostValuePlugin,
  sessionSearchDomainPlugin,
  sessionSearchHostValuePlugin,
  skillsDomainPlugin,
  storageValuePlugin,
  subagentDomainPlugin,
  toolOutputPolicyPlugin,
  workspaceToolDiscoveryValuePlugin,
  workflowDomainPlugin,
  workspacePolicyPlugin,
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID,
} from '@capekai/core/plugins';
import { builtinToolsAgentPlugins } from './tool-resolver';
import { jean2WorkspacePolicyOptions } from './workspace-policy';

export const JEAN2_PROCESS_PLUGIN_IDS = [
  'current.provider-registry',
  'current.installed-tool-registry',
  'current.session-search-host',
  'current.scheduler-host',
] as const;

export const JEAN2_AGENT_PLUGIN_IDS = [
  'prokopai.builtin-tools',
  'prokopai.tool-resolver',
  'current.storage',
  'current.runtime-configuration',
  'current.runtime-host',
  'current.agent-driver',
  'current.retry-policy',
  'current.compaction-policy',
  'current.permission-policy',
  'current.workspace-policy',
  'current.tool-output-policy',
  'current.context-sources',
  'current.context-sections',
  'current.orchestrator-session',
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
  CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID,
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  'current.workspace-tool-discovery',
  'current.sandbox-controller',
  'current.provider-overrides',
] as const;

export function jean2ProcessPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    providerRegistryValuePlugin('current.provider-registry'),
    installedToolRegistryValuePlugin('current.installed-tool-registry'),
    sessionSearchHostValuePlugin('current.session-search-host', getSessionSearchHost()),
    schedulerHostValuePlugin('current.scheduler-host', getSchedulerHost()),
  ];
}

export function jean2AgentPlugins(): readonly CapekPlugin<unknown>[] {
  return [
    ...builtinToolsAgentPlugins(),
    storageValuePlugin('current.storage', getStorage()),
    runtimeConfigurationValuePlugin('current.runtime-configuration', getRuntimeConfiguration()),
    runtimeHostValuePlugin('current.runtime-host', getRuntimeHost()),
    defaultAgentDriverPlugin('current.agent-driver'),
    retryPolicyPlugin('current.retry-policy'),
    compactionPolicyPlugin('current.compaction-policy'),
    permissionPolicyPlugin('current.permission-policy'),
    workspacePolicyPlugin('current.workspace-policy', jean2WorkspacePolicyOptions),
    toolOutputPolicyPlugin('current.tool-output-policy'),
    contextSourcesValuePlugin('current.context-sources', getContextSources()),
    createContextSectionsPlugin('current.context-sections', {
      includeSelfDelegationGuidance: false,
      includeSessionSearchGuidance: false,
      includeMemorySkillsSections: false,
    }),
    orchestratorSessionProviderPlugin('current.orchestrator-session'),
    sessionSearchDomainPlugin(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID),
    schedulerDomainPlugin(CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID),
    subagentDomainPlugin(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID),
    workflowDomainPlugin(CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID),
    goalDomainPlugin(CURRENT_GOAL_DOMAIN_PLUGIN_ID),
    memoryDomainPlugin(CURRENT_MEMORY_DOMAIN_PLUGIN_ID),
    skillsDomainPlugin(CURRENT_SKILLS_DOMAIN_PLUGIN_ID),
    workspaceToolDiscoveryValuePlugin('current.workspace-tool-discovery', getWorkspaceToolDiscovery()),
    sandboxControllerValuePlugin('current.sandbox-controller', getSandboxController()),
    providerOverridesValuePlugin('current.provider-overrides', new Map()),
  ];
}
