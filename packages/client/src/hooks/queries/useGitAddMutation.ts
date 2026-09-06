import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

interface GitAddTarget {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  root?: string;
  path: string;
}

export function useGitAddMutation(sdkClient: ProkopaiClient | null, workspaceId: string, root?: string) {
  const { mutate, isPending } = useMutation({
    mutationFn: async (target: GitAddTarget) => {
      if (!target.sdkClient) throw new Error('Server is not connected');
      return target.sdkClient.http.files.gitAdd(target.workspaceId, target.path, { root: target.root });
    },
    // Capture request identity in variables so switching roots during the request
    // cannot redirect the refresh to the newly focused workspace.
    onSuccess: async (_result, target) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...queryKeys.files.gitStatusPrefix, target.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: [...queryKeys.files.browsePrefix, target.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.files.gitDiff(target.workspaceId, target.path, target.root) }),
      ]);
    },
    onError: (error: Error) => {
      toast.error('Could not add file to Git', { description: error.message });
    },
  }, queryClient);
  const addToGit = useCallback((path: string) => {
    mutate({ sdkClient, workspaceId, root, path });
  }, [mutate, sdkClient, workspaceId, root]);
  return { mutate: addToGit, isPending };
}
