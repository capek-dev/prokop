import { useServerDataStore } from '@/stores/serverDataStore';

export function handleWorkspaceActivity(workspaceId: unknown, lastConversationAt: unknown): void {
  if (typeof workspaceId !== 'string' || !workspaceId) return;
  if (lastConversationAt !== null && (typeof lastConversationAt !== 'number' || !Number.isFinite(lastConversationAt) || lastConversationAt < 0)) return;
  useServerDataStore.setState(state => ({
    workspaces: state.workspaces.map(workspace => workspace.id === workspaceId ? { ...workspace, lastConversationAt } : workspace),
    activeWorkspace: state.activeWorkspace?.id === workspaceId ? { ...state.activeWorkspace, lastConversationAt } : state.activeWorkspace,
  }));
}
