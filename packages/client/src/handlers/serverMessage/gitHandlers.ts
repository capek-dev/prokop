import type { GitHead, GitStatusResponse } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

/** Branch-level Git views. Their keys are `[family, serverId, workspaceId, root, ...]`. */
const REF_QUERY_FAMILIES = new Set(['git-repository', 'git-branches', 'git-history', 'git-rebase']);

/** Repository, branches, history, rebase state, and worktree refs of one workspace. */
function invalidateGitRefs(workspaceId: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => REF_QUERY_FAMILIES.has(query.queryKey[0] as string) && query.queryKey[2] === workspaceId,
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.worktrees.refsByWorkspace(workspaceId) });
}

/** One Git operation can affect multiple roots/subdirectories of the same repository. */
export function handleGitChanged(workspaceId: string): void {
  // The server refreshes the pushed file tree of the root itself.
  for (const prefix of [queryKeys.files.gitStatusPrefix, queryKeys.files.browsePrefix, ['files', 'git-diff']]) {
    void queryClient.invalidateQueries({ queryKey: [...prefix, workspaceId] });
  }
  invalidateGitRefs(workspaceId);
}

/** Keeps the newer of two snapshots; pushes and HTTP reads can arrive in either order. */
export function newerGitStatus(
  current: GitStatusResponse | undefined,
  next: GitStatusResponse,
): GitStatusResponse {
  if (!current || current.root !== next.root) return next;
  return (current.revision ?? 0) > (next.revision ?? 0) ? current : next;
}

// Last seen HEAD per workspace root. Survives reconnects, so a commit made
// while disconnected still refreshes branch views on the next snapshot.
const lastHeads = new Map<string, GitHead | null>();

function sameHead(a: GitHead | null | undefined, b: GitHead | null | undefined): boolean {
  return (a?.oid ?? null) === (b?.oid ?? null) && (a?.branch ?? null) === (b?.branch ?? null);
}

/**
 * Pushed Git status for a subscribed root. Writes it into every matching
 * status query, and refreshes branch views only when HEAD moved (commit,
 * branch switch, rebase), which is how commits made by agents or terminals
 * reach the Branches panel.
 */
export function handleGitStatus(workspaceId: string, root: string, status: GitStatusResponse): void {
  const queries = queryClient.getQueriesData<GitStatusResponse>({
    queryKey: [...queryKeys.files.gitStatusPrefix, workspaceId],
  });
  for (const [key, current] of queries) {
    if (current?.root !== root) continue;
    const next = newerGitStatus(current, status);
    if (next !== current) queryClient.setQueryData(key, next);
  }

  const headKey = `${workspaceId}\0${root}`;
  const previous = lastHeads.get(headKey);
  lastHeads.set(headKey, status.head ?? null);
  if (previous !== undefined && !sameHead(previous, status.head)) invalidateGitRefs(workspaceId);
}

/** Test seam: forget remembered HEADs. */
export function resetGitStatusHeadsForTest(): void {
  lastHeads.clear();
}
