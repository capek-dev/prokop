import { afterEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { toast } from 'sonner';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useGitAddMutation } from '@/hooks/queries/useGitAddMutation';

afterEach(() => { cleanup(); queryClient.clear(); vi.restoreAllMocks(); });
function client(gitAdd: unknown): ProkopaiClient {
  return { http: { files: { gitAdd } } } as ProkopaiClient;
}

describe('Git add mutation', () => {
  test('keeps the original request root when the view switches before completion', async () => {
    let resolve!: (value: { path: string }) => void;
    const gitAdd = vi.fn(() => new Promise<{ path: string }>((done) => { resolve = done; }));
    const sdk = client(gitAdd);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const { result, rerender } = renderHook(
      ({ workspaceId, root }) => useGitAddMutation(sdk, workspaceId, root),
      { initialProps: { workspaceId: 'ws-1', root: '/worktree' } },
    );
    act(() => result.current.mutate('new.txt'));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    rerender({ workspaceId: 'ws-2', root: '/other' });
    await act(async () => resolve({ path: 'new.txt' }));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(gitAdd).toHaveBeenCalledExactlyOnceWith('ws-1', 'new.txt', { root: '/worktree' });
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: [...queryKeys.files.gitStatusPrefix, 'ws-1'] }],
      [{ queryKey: [...queryKeys.files.browsePrefix, 'ws-1'] }],
      [{ queryKey: queryKeys.files.gitDiff('ws-1', 'new.txt', '/worktree') }],
    ]);
  });

  test('reports failures without changing cached status', async () => {
    const gitAdd = vi.fn().mockRejectedValue(new Error('index locked'));
    const errorToast = vi.spyOn(toast, 'error').mockReturnValue('toast');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useGitAddMutation(client(gitAdd), 'ws-1'));
    act(() => result.current.mutate('new.txt'));
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Could not add file to Git', { description: 'index locked' }));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
