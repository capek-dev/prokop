import { useQuery } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

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
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnReconnect: false,
    refetchOnMount: false,
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
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnReconnect: false,
    refetchOnMount: false,
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

export function useGitStatusQuery(
  sdkClient: ProkopaiClient | null,
  workspaceId: string | undefined,
  root: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.files.gitStatus(workspaceId ?? '', root),
    queryFn: () => sdkClient!.http.files.gitStatus(workspaceId!, { root }),
    enabled: !!sdkClient && !!workspaceId && enabled,
    staleTime: FILE_CONTENT_STALE_TIME_MS,
  });
}
