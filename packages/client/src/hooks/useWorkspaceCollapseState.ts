import { useState, useCallback } from 'react';

const STORAGE_KEY = 'prokopai_collapsed_workspaces';

function loadCollapsedWorkspaces(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      return new Set(parsed);
    }
  } catch {
    // ignore
  }
  return new Set();
}

function saveCollapsedWorkspaces(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
}

export function useWorkspaceCollapseState(initialOpenIds: string[] = []) {
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(loadCollapsedWorkspaces);

  const isWorkspaceOpen = useCallback(
    (workspaceId: string) => {
      if (!collapsedWorkspaces.has(workspaceId)) return true;
      return initialOpenIds.includes(workspaceId);
    },
    [collapsedWorkspaces, initialOpenIds],
  );

  const toggleWorkspace = useCallback((workspaceId: string, open: boolean) => {
    setCollapsedWorkspaces(prev => {
      const next = new Set(prev);
      if (open) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      saveCollapsedWorkspaces(next);
      return next;
    });
  }, []);

  return { isWorkspaceOpen, toggleWorkspace };
}
