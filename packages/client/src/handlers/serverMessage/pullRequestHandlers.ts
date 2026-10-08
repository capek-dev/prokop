import { queryClient } from '@/components/providers/QueryProvider';

export function handlePullRequestChanged(
  serverId: string,
  workspaceId?: string,
  repositoryKey?: string,
): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] === 'pull-requests' &&
      query.queryKey[1] === serverId &&
      (workspaceId === undefined || query.queryKey[2] === workspaceId) &&
      (repositoryKey === undefined || query.queryKey[3] === repositoryKey),
  });
}
