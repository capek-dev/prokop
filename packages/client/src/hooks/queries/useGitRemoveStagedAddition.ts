import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

interface Target { sdkClient: ProkopaiClient | null; workspaceId: string; root?: string; path: string }
export function useGitRemoveStagedAddition(sdkClient: ProkopaiClient | null, workspaceId: string, root?: string) {
  const mutation = useMutation({
    mutationFn: async (target: Target) => {
      if (!target.sdkClient) throw new Error('Server is not connected');
      return target.sdkClient.http.files.gitRemoveStagedAddition(target.workspaceId, target.path, { root: target.root });
    },
    retry: false,
    onSuccess: (_result, target) => {
      for (const prefix of [queryKeys.files.gitStatusPrefix, queryKeys.files.browsePrefix]) {
        void queryClient.invalidateQueries({ queryKey: [...prefix, target.workspaceId] });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files.gitDiff(target.workspaceId, target.path, target.root) });
    },
    onError: (error) => toast.error('Could not remove staged addition', { description: error.message }),
  }, queryClient);
  return { isPending: mutation.isPending, mutate: (path: string) => mutation.mutate({ sdkClient, workspaceId, root, path }) };
}
