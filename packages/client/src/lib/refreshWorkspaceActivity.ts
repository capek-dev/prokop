import type { ProkopaiClient } from '@prokopai/sdk';
import { useServerDataStore } from '@/stores/serverDataStore';

/** Refresh missed activity without overwriting events received during the request. */
export async function refreshWorkspaceActivity(client: ProkopaiClient, isCurrent: () => boolean): Promise<void> {
  const initial = useServerDataStore.getState();
  const snapshot = new Map(initial.workspaces.map(workspace => [workspace.id, workspace]));
  const { workspaces } = await client.http.workspaces.list();
  if (!isCurrent() || useServerDataStore.getState().serverId !== initial.serverId) return;
  const activity = new Map(workspaces.map(workspace => [workspace.id, workspace.lastConversationAt]));
  useServerDataStore.setState(state => {
    const next = state.workspaces.map(workspace => snapshot.get(workspace.id) === workspace && activity.has(workspace.id)
      ? { ...workspace, lastConversationAt: activity.get(workspace.id) }
      : workspace);
    return {
      workspaces: next,
      activeWorkspace: next.find(workspace => workspace.id === state.activeWorkspace?.id) ?? state.activeWorkspace,
    };
  });
}
