import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ManagedWorktree, ProkopaiClient, Session } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { useSessionStore } from '@/stores/sessionStore';

export function useWorktreeRefsQuery(
  client: ProkopaiClient | null,
  workspaceId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.worktrees.refsByWorkspace(workspaceId ?? ''),
    queryFn: async () => {
      if (!client || !workspaceId) return [];
      return (await client.http.workspaces.listWorktreeRefs(workspaceId)).refs;
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 15_000,
  });
}

export function useWorktreesQuery(
  client: ProkopaiClient | null,
  workspaceId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.worktrees.byWorkspace(workspaceId ?? ''),
    queryFn: async () => {
      if (!client || !workspaceId) return [];
      return (await client.http.workspaces.listWorktrees(workspaceId)).worktrees;
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 15_000,
  });
}

function replaceSession(session: Session): void {
  const store = useSessionStore.getState();
  store.setSessions((current) => current.map((item) => (
    item.id === session.id ? session : item
  )));
}

export function useWorktreeMutations(
  client: ProkopaiClient | null,
  workspaceId: string | undefined,
) {
  const queryClient = useQueryClient();
  const key = queryKeys.worktrees.byWorkspace(workspaceId ?? '');
  const refsKey = queryKeys.worktrees.refsByWorkspace(workspaceId ?? '');

  const create = useMutation({
    mutationFn: async (input: { name: string; branch: string }) => {
      if (!client || !workspaceId) throw new Error('Workspace is not available');
      return (await client.http.workspaces.createWorktree(workspaceId, input)).worktree;
    },
    onSuccess: (worktree) => {
      queryClient.setQueryData<ManagedWorktree[]>(key, (current = []) => [
        worktree,
        ...current.filter((item) => item.id !== worktree.id),
      ]);
      void queryClient.invalidateQueries({ queryKey: refsKey });
    },
  });

  const remove = useMutation({
    mutationFn: async (worktreeId: string) => {
      if (!client || !workspaceId) throw new Error('Workspace is not available');
      return (await client.http.workspaces.removeWorktree(workspaceId, worktreeId)).worktree;
    },
    onSuccess: (worktree) => {
      queryClient.setQueryData<ManagedWorktree[]>(key, (current = []) => current.map((item) => (
        item.id === worktree.id ? worktree : item
      )));
    },
  });

  const bind = useMutation({
    mutationFn: async ({ sessionId, worktreeId }: { sessionId: string; worktreeId: string }) => {
      if (!client) throw new Error('Server is not available');
      return (await client.http.sessions.bindWorktree(sessionId, worktreeId)).session;
    },
    onSuccess: replaceSession,
  });

  const unbind = useMutation({
    mutationFn: async (sessionId: string) => {
      if (!client) throw new Error('Server is not available');
      return (await client.http.sessions.unbindWorktree(sessionId)).session;
    },
    onSuccess: replaceSession,
  });

  return { create, remove, bind, unbind };
}
