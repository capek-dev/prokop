import type { Preconfig, Workspace } from '@prokopai/sdk';

/**
 * Returns the preconfigs visible for a workspace: every primary/both
 * preconfig. The per-workspace selection list no longer exists; agents are
 * global and visible everywhere.
 */
export function getWorkspacePreconfigs(workspace: Workspace | null, preconfigs: Preconfig[]): Preconfig[] {
  void workspace;
  return preconfigs.filter(p => p.mode !== 'subagent');
}

/**
 * Returns the default preconfig ID for a workspace.
 * Priority: workspace default > owning agent (agent homes) > first primary preconfig.
 */
export function getWorkspaceDefaultPreconfigId(workspace: Workspace | null, preconfigs: Preconfig[]): string | undefined {
  const wsDefault = workspace?.settings?.preconfigs?.defaultId;
  if (wsDefault) return wsDefault;

  if (workspace?.settings?.isAgentHome && workspace.settings.agentId) {
    return workspace.settings.agentId;
  }

  return preconfigs.find(p => p.mode !== 'subagent')?.id;
}
