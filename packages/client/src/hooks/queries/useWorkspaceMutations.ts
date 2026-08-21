import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient, Workspace } from '@prokopai/sdk';
import type { RefObject } from 'react';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';

interface CreateWorkspaceResult {
  workspace: Workspace;
}

interface DeleteWorkspaceResult {
  deletedSessions: string[];
}

interface RenameWorkspaceResult {
  workspace: Workspace;
}

export function useCreateWorkspaceMutation(clientRef: RefObject<ProkopaiClient | null>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, path, isVirtual }: {
      name: string;
      path: string;
      isVirtual: boolean;
    }): Promise<CreateWorkspaceResult> => {
      const http = clientRef.current?.httpClient;
      if (!http) throw new Error('Not connected');
      return http.post<CreateWorkspaceResult>('/workspaces', { name, path, isVirtual });
    },
    onSuccess: ({ workspace }) => {
      const store = useServerDataStore.getState();
      store.setWorkspaces([...store.workspaces, workspace]);
      store.setActiveWorkspace(workspace);
      localStorage.setItem('activeWorkspaceId', workspace.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
}

export function useDeleteWorkspaceMutation(clientRef: RefObject<ProkopaiClient | null>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<DeleteWorkspaceResult & { id: string }> => {
      const http = clientRef.current?.httpClient;
      if (!http) throw new Error('Not connected');
      const data = await http.delete<DeleteWorkspaceResult>(`/workspaces/${id}`);
      return { ...data, id };
    },
    onSuccess: ({ id, deletedSessions }) => {
      const store = useServerDataStore.getState();
      const sessionStore = useSessionStore.getState();

      sessionStore.setSessions(prev => prev.filter(s => !deletedSessions.includes(s.id)));
      sessionStore.setMessagesBySession(prev => {
        const next = { ...prev };
        deletedSessions.forEach(sessionId => delete next[sessionId]);
        return next;
      });
      sessionStore.setPartsBySession(prev => {
        const next = { ...prev };
        deletedSessions.forEach(sessionId => delete next[sessionId]);
        return next;
      });

      const currentWorkspaces = store.workspaces;
      store.setWorkspaces(currentWorkspaces.filter(w => w.id !== id));

      if (store.activeWorkspace?.id === id) {
        const remaining = currentWorkspaces.filter(w => w.id !== id);
        const newActive = remaining[0] || null;
        store.setActiveWorkspace(newActive);
        if (newActive) {
          localStorage.setItem('activeWorkspaceId', newActive.id);
        } else {
          localStorage.removeItem('activeWorkspaceId');
        }
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
    },
  });
}

export function useRenameWorkspaceMutation(clientRef: RefObject<ProkopaiClient | null>) {
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }): Promise<RenameWorkspaceResult> => {
      const http = clientRef.current?.httpClient;
      if (!http) throw new Error('Not connected');
      return http.patch<RenameWorkspaceResult>(`/workspaces/${id}`, { name });
    },
    onSuccess: ({ workspace: updatedWorkspace }) => {
      const store = useServerDataStore.getState();
      store.setWorkspaces(
        store.workspaces.map(w => w.id === updatedWorkspace.id ? updatedWorkspace : w),
      );
      if (store.activeWorkspace?.id === updatedWorkspace.id) {
        store.setActiveWorkspace(updatedWorkspace);
      }
    },
  });
}

export function useUpdateWorkspaceMutation(clientRef: RefObject<ProkopaiClient | null>) {
  return useMutation({
    mutationFn: async ({ id, additionalPaths }: { id: string; additionalPaths: string[] }): Promise<RenameWorkspaceResult> => {
      const http = clientRef.current?.httpClient;
      if (!http) throw new Error('Not connected');
      return http.patch<RenameWorkspaceResult>(`/workspaces/${id}`, { additionalPaths });
    },
    onSuccess: ({ workspace: updatedWorkspace }) => {
      const store = useServerDataStore.getState();
      store.setWorkspaces(
        store.workspaces.map(w => w.id === updatedWorkspace.id ? updatedWorkspace : w),
      );
      if (store.activeWorkspace?.id === updatedWorkspace.id) {
        store.setActiveWorkspace(updatedWorkspace);
      }
    },
  });
}
