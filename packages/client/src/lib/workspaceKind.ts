import type { Agent, Workspace } from '@prokopai/sdk';

export const AGENT_HOME_LABEL = 'Agent home';

export function isAgentHomeWorkspace(
  workspace: Pick<Workspace, 'settings'> | null | undefined,
): boolean {
  return workspace?.settings?.isAgentHome === true;
}

export function getWorkspaceDisplayName(
  workspace: Pick<Workspace, 'name' | 'settings'>,
  agents: Pick<Agent, 'id' | 'name'>[],
): string {
  const agentId = workspace.settings?.agentId;
  if (!isAgentHomeWorkspace(workspace) || !agentId) return workspace.name;
  return agents.find(agent => agent.id === agentId)?.name ?? workspace.name;
}
