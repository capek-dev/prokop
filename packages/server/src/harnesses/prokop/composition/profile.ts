/** The Jean2 server composition profile and its exact plugin inventory. */

import type { RuntimePlugin } from '@/harnesses/prokop/composition/plugins/compose';
import { compactionPolicyPlugin } from '@/harnesses/prokop/composition/plugins/compaction-policy';
import {
  contextSourcesValuePlugin,
  installedToolRegistryValuePlugin,
  providerOverridesValuePlugin,
  providerRegistryValuePlugin,
  runtimeConfigurationValuePlugin,
  runtimeHostValuePlugin,
  sandboxControllerValuePlugin,
  sessionSearchHostValuePlugin,
  storageValuePlugin,
  workspaceToolDiscoveryValuePlugin,
} from '@/harnesses/prokop/composition/plugins/value-plugins';
import { createContextSectionsPlugin } from '@/harnesses/prokop/composition/plugins/context-sections';
import { defaultAgentDriverPlugin } from '@/harnesses/prokop/composition/plugins/default-agent-driver';
import { getContextSources } from '@/harnesses/prokop/context/sources';
import { getRuntimeConfiguration } from '@/infrastructure/providers/configuration/runtime';
import { getRuntimeHost } from '@/infrastructure/runtime/host';
import { getSandboxController } from '@/infrastructure/sandbox/controller';
import { getSessionSearchHost } from '@/harnesses/shared/session-search/host';
import { getStorage } from '@/infrastructure/storage/runtime';
import { getWorkspaceToolDiscovery } from '@/infrastructure/tools/tool-source';
import { goalDomainPlugin, CURRENT_GOAL_DOMAIN_PLUGIN_ID } from '@/harnesses/prokop/composition/plugins/goal-domain';
import {
  memoryDomainPlugin,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
} from '@/harnesses/prokop/composition/plugins/memory-domain';
import { orchestratorSessionProviderPlugin } from '@/harnesses/prokop/composition/plugins/orchestrator-session';
import { permissionPolicyPlugin } from '@/harnesses/prokop/composition/plugins/permission-policy';
import { retryPolicyPlugin } from '@/harnesses/prokop/composition/plugins/retry-policy';
import {
  sessionSearchDomainPlugin,
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
} from '@/harnesses/prokop/composition/plugins/session-search-domain';
import {
  skillsDomainPlugin,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
} from '@/harnesses/prokop/composition/plugins/skills-domain';
import {
  subagentDomainPlugin,
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
} from '@/harnesses/prokop/composition/plugins/subagent-domain';
import { toolOutputPolicyPlugin } from '@/harnesses/prokop/composition/plugins/tool-output-policy';
import { workspacePolicyPlugin } from '@/harnesses/prokop/composition/plugins/workspace-policy';
import { builtinTools } from '@/harnesses/prokop/tools';
import { builtinToolsAgentPlugins } from '@/harnesses/prokop/host/tool-resolver';
import { prokopWorkspacePolicyOptions } from '@/harnesses/prokop/host/workspace-policy';

export const JEAN2_PROCESS_PLUGIN_IDS = [
  'current.provider-registry',
  'current.installed-tool-registry',
  'current.session-search-host',
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
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  'current.workspace-tool-discovery',
  'current.sandbox-controller',
  'current.provider-overrides',
] as const;

export function prokopProcessPlugins(): readonly RuntimePlugin<unknown>[] {
  return [
    providerRegistryValuePlugin('current.provider-registry'),
    installedToolRegistryValuePlugin('current.installed-tool-registry'),
    sessionSearchHostValuePlugin('current.session-search-host', getSessionSearchHost()),
  ];
}

export function prokopAgentPlugins(): readonly RuntimePlugin<unknown>[] {
  return [
    ...builtinToolsAgentPlugins(builtinTools),
    storageValuePlugin('current.storage', getStorage()),
    runtimeConfigurationValuePlugin('current.runtime-configuration', getRuntimeConfiguration()),
    runtimeHostValuePlugin('current.runtime-host', getRuntimeHost()),
    defaultAgentDriverPlugin('current.agent-driver'),
    retryPolicyPlugin('current.retry-policy'),
    compactionPolicyPlugin('current.compaction-policy'),
    permissionPolicyPlugin('current.permission-policy'),
    workspacePolicyPlugin('current.workspace-policy', prokopWorkspacePolicyOptions),
    toolOutputPolicyPlugin('current.tool-output-policy'),
    contextSourcesValuePlugin('current.context-sources', getContextSources()),
    createContextSectionsPlugin('current.context-sections', {
      includeSelfDelegationGuidance: false,
      includeSessionSearchGuidance: false,
      includeMemorySkillsSections: false,
    }),
    orchestratorSessionProviderPlugin('current.orchestrator-session'),
    sessionSearchDomainPlugin(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID),
    subagentDomainPlugin(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID),
    goalDomainPlugin(CURRENT_GOAL_DOMAIN_PLUGIN_ID),
    memoryDomainPlugin(CURRENT_MEMORY_DOMAIN_PLUGIN_ID),
    skillsDomainPlugin(CURRENT_SKILLS_DOMAIN_PLUGIN_ID),
    workspaceToolDiscoveryValuePlugin('current.workspace-tool-discovery', getWorkspaceToolDiscovery()),
    sandboxControllerValuePlugin('current.sandbox-controller', getSandboxController()),
    providerOverridesValuePlugin('current.provider-overrides', new Map()),
  ];
}
