import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useDeletePreconfig } from '@/hooks/queries/usePreconfigsQueries';
import { queryKeys } from '@/lib/queryKeys';
import { useServerDataStore } from '@/stores/serverDataStore';

const initialState = useServerDataStore.getState();
afterEach(() => {
  cleanup();
  useServerDataStore.setState(initialState, true);
});

test('deletion refreshes agents in the store and cache without deleting home resources', async () => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const deletePreconfig = vi.fn().mockResolvedValue({ success: true });
  const listAgents = vi.fn().mockResolvedValue({ agents: [] });
  const deleteAgent = vi.fn();
  const deleteWorkspace = vi.fn();
  const sdkClient = { http: {
    preconfigs: { delete: deletePreconfig, list: vi.fn().mockResolvedValue({ preconfigs: [] }) },
    agents: { list: listAgents, delete: deleteAgent },
    workspaces: { delete: deleteWorkspace },
  } } as unknown as ProkopaiClient;
  const updateAgents = vi.spyOn(useServerDataStore.getState(), 'updateAgents');
  const workspaces = useServerDataStore.getState().workspaces;
  const { result } = renderHook(() => useDeletePreconfig(sdkClient), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
  try {
    await act(async () => { await result.current.mutateAsync('deleted'); });
    expect(deletePreconfig).toHaveBeenCalledWith('deleted');
    expect(listAgents).toHaveBeenCalledOnce();
    expect(updateAgents).toHaveBeenCalledWith([]);
    expect(queryClient.getQueryData(queryKeys.config.agents)).toEqual({ agents: [] });
    expect(useServerDataStore.getState().workspaces).toBe(workspaces);
    expect(deleteAgent).not.toHaveBeenCalled();
    expect(deleteWorkspace).not.toHaveBeenCalled();
  } finally {
    updateAgents.mockRestore();
    queryClient.clear();
  }
});
