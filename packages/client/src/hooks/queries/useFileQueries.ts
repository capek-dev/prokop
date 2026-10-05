import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GitStatusResponse, ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';
import { retainGitStatus } from '@/lib/gitStatusSubscriptions';
import { newerGitStatus } from '@/handlers/serverMessage/gitHandlers';

const FILE_BROWSE_STALE_TIME_MS = 10_000;
const FILE_CONTENT_STALE_TIME_MS = 5_000;

export function useFileBrowseQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  path?: string,
  opts?: { showHidden?: boolean; root?: string },
  enabledOverride?: boolean,
) {
  return useQuery({
    queryKey: queryKeys.files.browse(workspaceId ?? '', path, opts),
    queryFn: ({ signal }) => sdkClient!.http.files.browse(workspaceId!, path, { ...opts, signal }),
    enabled: !!sdkClient && !!workspaceId && (enabledOverride ?? true),
    staleTime: FILE_BROWSE_STALE_TIME_MS,
  });
}

export function useFileSearchQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  query: string,
  root?: string,
) {
  return useQuery({
    queryKey: queryKeys.files.search(workspaceId ?? '', query, root),
    queryFn: ({ signal }) => sdkClient!.http.files.search(
      workspaceId!,
      query,
      { showHidden: true, root, limit: 50, signal },
    ),
    enabled: !!sdkClient && !!workspaceId && query.length >= 2,
    staleTime: FILE_BROWSE_STALE_TIME_MS,
  });
}

export function useFileBrowseFsQuery(
  sdkClient: ProkopaiClient | null,
  path: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.browseFs(path),
    queryFn: () => sdkClient!.http.files.browseFs(path),
    enabled: !!sdkClient && enabled,
  });
}

export function useFileDrivesQuery(sdkClient: ProkopaiClient | null) {
  return useQuery({
    queryKey: queryKeys.files.drives,
    queryFn: () => sdkClient!.http.files.drives(),
    enabled: !!sdkClient,
  });
}

export function useFileParentQuery(
  sdkClient: ProkopaiClient | null,
  currentPath: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.parent(currentPath),
    queryFn: () => sdkClient!.http.files.parent(currentPath),
    enabled: !!sdkClient && enabled,
  });
}

export function useFilePreviewQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  path: string | undefined,
  root: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.preview(workspaceId ?? '', path ?? '', root),
    queryFn: () => sdkClient!.http.files.preview(workspaceId!, path!, { root }),
    enabled: !!sdkClient && !!workspaceId && !!path && enabled,
    // staleTime Infinity keeps first-open instant; without refetchOnMount:
    // false a query invalidated by files.changed refetches when reopened.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useFileGitDiffQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  path: string | undefined,
  root: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.gitDiff(workspaceId ?? '', path ?? '', root),
    queryFn: () => sdkClient!.http.files.gitDiff(workspaceId!, path!, { root }),
    enabled: !!sdkClient && !!workspaceId && !!path && enabled,
    // Same policy as the preview query: instant open, but a files.changed
    // invalidation makes the next mount refetch instead of showing a stale
    // cached diff.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Editor-specific Git diff query with a finite stale time so active editor
 * documents refresh on focus, reconnect, and explicit invalidation.
 *
 * Uses the same queryKey as `useFileGitDiffQuery` so cache identity is shared,
 * but with different caching semantics for the editor lifecycle.
 */
export function useEditorGitDiffQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  path: string | undefined,
  root: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.gitDiff(workspaceId ?? '', path ?? '', root),
    queryFn: ({ signal }) => sdkClient!.http.files.gitDiff(workspaceId!, path!, { root, signal }),
    enabled: !!sdkClient && !!workspaceId && !!path && enabled,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}

/** Keeps the server's Git status feed for a root alive while mounted. */
export function useGitStatusSubscription(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  root: string | undefined,
  enabled = true,
): void {
  useEffect(() => {
    if (!sdkClient || !workspaceId || !enabled) return;
    return retainGitStatus(sdkClient, workspaceId, root);
  }, [sdkClient, workspaceId, root, enabled]);
}

export function useGitStatusQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  root: string | undefined,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.files.gitStatus(workspaceId ?? '', root);
  useGitStatusSubscription(sdkClient, workspaceId, root, enabled);
  return useQuery({
    queryKey,
    queryFn: async () => newerGitStatus(
      queryClient.getQueryData<GitStatusResponse>(queryKey),
      await sdkClient!.http.files.gitStatus(workspaceId!, { root }),
    ),
    enabled: !!sdkClient && !!workspaceId && enabled,
    staleTime: FILE_CONTENT_STALE_TIME_MS,
  });
}
