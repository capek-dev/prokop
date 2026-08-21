import { useState, useCallback, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileEntry, FileListResponse, ProkopaiClient } from '@prokopai/sdk';
import { queryKeys } from '@/lib/queryKeys';

const FILE_BROWSE_STALE_TIME_MS = 10_000;

export interface VisibleFileNode {
  id: string;
  entry: FileEntry;
  fullPath: string;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  parentId: string | null;
}

interface UseFlatFileTreeParams {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  showHidden: boolean;
  root?: string;
}

interface UseFlatFileTreeReturn {
  visibleNodes: VisibleFileNode[];
  isLoading: boolean;
  error: Error | null;
  currentPath: string;
  expandedPaths: Set<string>;
  toggleExpanded: (fullPath: string) => void;
  isExpanded: (fullPath: string) => boolean;
  refetchRoot: () => void;
  prefetchDirectory: (fullPath: string) => void;
}

export function useFlatFileTree({
  sdkClient,
  workspaceId,
  showHidden,
  root,
}: UseFlatFileTreeParams): UseFlatFileTreeReturn {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const opts = useMemo(() => ({ showHidden, root }), [showHidden, root]);

  // Root directory query
  const rootQuery = useQuery({
    queryKey: queryKeys.files.browse(workspaceId, undefined, opts),
    queryFn: ({ signal }) => sdkClient!.http.files.browse(workspaceId, undefined, { ...opts, signal }),
    enabled: !!sdkClient && !!workspaceId,
    staleTime: FILE_BROWSE_STALE_TIME_MS,
  });

  const expandedArray = useMemo(() => [...expandedPaths], [expandedPaths]);

  // One query per expanded directory
  const expandedQueries = useQueries({
    queries: expandedArray.map((path) => ({
      queryKey: queryKeys.files.browse(workspaceId, path, opts),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        sdkClient!.http.files.browse(workspaceId, path, { ...opts, signal }),
      enabled: !!sdkClient,
      staleTime: FILE_BROWSE_STALE_TIME_MS,
    })),
  });

  // Build a lookup: fullPath -> children
  const childrenByPath = useMemo(() => {
    const map = new Map<string, FileEntry[]>();
    for (let i = 0; i < expandedArray.length; i++) {
      const path = expandedArray[i];
      const result = expandedQueries[i]?.data as FileListResponse | undefined;
      if (result?.files) {
        map.set(path, result.files);
      }
    }
    return map;
  }, [expandedArray, expandedQueries]);

  // Loading state per expanded path
  const loadingPaths = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < expandedArray.length; i++) {
      const q = expandedQueries[i];
      if (q?.isLoading) {
        set.add(expandedArray[i]);
      }
    }
    return set;
  }, [expandedArray, expandedQueries]);

  // Flatten visible nodes from root + expanded directories
  const visibleNodes = useMemo(() => {
    const nodes: VisibleFileNode[] = [];
    const rootFiles = rootQuery.data?.files ?? [];

    function buildNode(entry: FileEntry, fullPath: string, depth: number, parentId: string | null) {
      const isExpanded = expandedPaths.has(fullPath);
      nodes.push({
        id: fullPath,
        entry,
        fullPath,
        depth,
        isExpanded,
        isLoading: loadingPaths.has(fullPath),
        parentId,
      });

      if (entry.type === 'directory' && isExpanded) {
        const children = childrenByPath.get(fullPath) ?? [];
        for (const child of children) {
          const childPath = `${fullPath}/${child.path}`;
          buildNode(child, childPath, depth + 1, fullPath);
        }
      }
    }

    for (const file of rootFiles) {
      buildNode(file, file.path, 0, null);
    }

    return nodes;
  }, [rootQuery.data, expandedPaths, childrenByPath, loadingPaths]);

  const toggleExpanded = useCallback((fullPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) {
        next.delete(fullPath);
      } else {
        next.add(fullPath);
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback(
    (fullPath: string) => expandedPaths.has(fullPath),
    [expandedPaths],
  );

  const refetchRoot = useCallback(() => {
    rootQuery.refetch();
  }, [rootQuery]);

  const prefetchDirectory = useCallback((fullPath: string) => {
    if (!sdkClient) return;
    queryClient.prefetchQuery({
      queryKey: queryKeys.files.browse(workspaceId, fullPath, opts),
      queryFn: ({ signal }) =>
        sdkClient.http.files.browse(workspaceId, fullPath, { ...opts, signal }),
      staleTime: FILE_BROWSE_STALE_TIME_MS,
    });
  }, [sdkClient, workspaceId, opts, queryClient]);

  return {
    visibleNodes,
    isLoading: rootQuery.isLoading,
    error: rootQuery.error,
    currentPath: rootQuery.data?.currentPath ?? '',
    expandedPaths,
    toggleExpanded,
    isExpanded,
    refetchRoot,
    prefetchDirectory,
  };
}
