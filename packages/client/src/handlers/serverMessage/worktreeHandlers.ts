import type { ManagedWorktree } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

export function handleWorktreeUpdated(worktree: ManagedWorktree): void {
  const key = queryKeys.worktrees.byWorkspace(worktree.workspaceId);
  const current = queryClient.getQueryData<ManagedWorktree[]>(key);
  if (current) {
    queryClient.setQueryData<ManagedWorktree[]>(key, [
      worktree,
      ...current.filter((item) => item.id !== worktree.id),
    ]);
  }
  queryClient.invalidateQueries({ queryKey: key });
}

export function handleWorktreeDeleted(worktree: ManagedWorktree): void {
  const key = queryKeys.worktrees.byWorkspace(worktree.workspaceId);
  queryClient.setQueryData<ManagedWorktree[]>(key, (current = []) =>
    current.filter((item) => item.id !== worktree.id),
  );
  queryClient.invalidateQueries({ queryKey: key });
}

export const worktreeHandlers = {
  'worktree.updated': handleWorktreeUpdated,
  'worktree.deleted': handleWorktreeDeleted,
} as const;
