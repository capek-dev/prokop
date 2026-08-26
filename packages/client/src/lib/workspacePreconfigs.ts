import type { Preconfig, Workspace } from '@prokopai/sdk';

/**
 * Returns the preconfig IDs selected for a workspace.
 * Falls back to all primary preconfig IDs when no selection is configured.
 */
export function getWorkspacePreconfigIds(workspace: Workspace | null, preconfigs: Preconfig[]): string[] {
  const selectedIds = workspace?.settings?.preconfigs?.selectedIds;
  if (selectedIds && selectedIds.length > 0) {
    return selectedIds;
  }
  return preconfigs.filter(p => p.mode !== 'subagent').map(p => p.id);
}

/**
 * Returns the preconfigs that are visible/available for a workspace.
 * When no selection is configured, all primary preconfigs are returned.
 */
export function getWorkspacePreconfigs(workspace: Workspace | null, preconfigs: Preconfig[]): Preconfig[] {
  const selectedIds = getWorkspacePreconfigIds(workspace, preconfigs);
  const idSet = new Set(selectedIds);
  return preconfigs.filter(p => idSet.has(p.id));
}

/**
 * Returns the default preconfig ID for a workspace.
 * Priority: workspace default > first visible workspace preconfig > first primary preconfig.
 */
export function getWorkspaceDefaultPreconfigId(workspace: Workspace | null, preconfigs: Preconfig[]): string | undefined {
  const wsDefault = workspace?.settings?.preconfigs?.defaultId;
  if (wsDefault) return wsDefault;

  if (workspace?.settings?.isAgentHome && workspace.settings.agentId) {
    return workspace.settings.agentId;
  }

  const visible = getWorkspacePreconfigs(workspace, preconfigs);
  if (visible.length > 0) return visible[0].id;

  return preconfigs.find(p => p.mode !== 'subagent')?.id;
}
