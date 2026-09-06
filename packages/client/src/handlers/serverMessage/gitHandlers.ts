import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

/** One Git operation can affect multiple roots/subdirectories of the same repository. */
export function handleGitChanged(workspaceId: string): void {
  for (const prefix of [queryKeys.files.gitStatusPrefix, queryKeys.files.browsePrefix, ['files', 'git-diff']]) {
    void queryClient.invalidateQueries({ queryKey: [...prefix, workspaceId] });
  }
  void queryClient.invalidateQueries({ queryKey: ['git-repository'] });
  void queryClient.invalidateQueries({ queryKey: ['git-branches'] });
  void queryClient.invalidateQueries({ queryKey: ['git-rebase'] });
  void queryClient.invalidateQueries({ queryKey: [...queryKeys.files.treePrefix, workspaceId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.worktrees.refsByWorkspace(workspaceId) });
}
