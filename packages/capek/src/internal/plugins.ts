/** Public composition plugin inventory for embedding hosts. */

export {
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
  toolResolverValuePlugin,
  workspaceToolDiscoveryValuePlugin,
} from '../plugins/value-plugins';
export { retryPolicyPlugin } from '../plugins/retry-policy';
export { compactionPolicyPlugin } from '../plugins/compaction-policy';
export { permissionPolicyPlugin } from '../plugins/permission-policy';
export { workspacePolicyPlugin } from '../plugins/workspace-policy';
export { toolOutputPolicyPlugin } from '../plugins/tool-output-policy';
export { defaultAgentDriverPlugin } from '../plugins/default-agent-driver';
export { createContextSectionsPlugin } from '../plugins/context-sections';
export { orchestratorSessionProviderPlugin } from '../plugins/orchestrator-session';
export {
  CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID,
  sessionSearchDomainPlugin,
} from '../plugins/session-search-domain';
export {
  CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
  schedulerDomainPlugin,
} from '../plugins/scheduler-domain';
export {
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  subagentDomainPlugin,
} from '../plugins/subagent-domain';
export {
  CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID,
  workflowDomainPlugin,
} from '../plugins/workflow-domain';
export {
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  goalDomainPlugin,
} from '../plugins/goal-domain';
export {
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  memoryDomainPlugin,
} from '../plugins/memory-domain';
export {
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  skillsDomainPlugin,
} from '../plugins/skills-domain';
export {
  FACADE_AGENT_PLUGIN_IDS,
  FACADE_PROCESS_PLUGIN_IDS,
  createFacadeAgentPlugins,
  facadeProcessPlugins,
  type FacadeScopeValues,
} from '../plugins/facade-plugins';
export { loadedToolsPlugin } from '../plugins/loaded-tools';
export { createContributedToolResolver } from '../plugins/tool-catalog';
export {
  getContextSources,
} from '../context/sources';
export { getRuntimeConfiguration } from '../configuration/runtime';
export { getRuntimeHost } from '../runtime/host';
export { getWorkspaceToolDiscovery } from '../tools/tool-source';
export { getSandboxController } from '../sandbox/controller';
export { getStorage } from '../storage/runtime';
export { getSessionSearchHost } from '../session-search/host';
export { getSchedulerHost } from '../scheduler/host';
