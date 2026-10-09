import { useCallback, useState } from 'react';

export type SessionGrouping = 'tags' | 'checkout';

const STORAGE_KEY = 'prokopai_session_grouping';

function load(): Record<string, SessionGrouping> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, SessionGrouping> : {};
  } catch {
    return {};
  }
}

/** How the active session list is grouped, remembered per workspace on this device. */
export function useSessionGrouping(workspaceId: string | null | undefined): [SessionGrouping, (grouping: SessionGrouping) => void] {
  const [stored, setStored] = useState(load);
  const grouping: SessionGrouping = (workspaceId && stored[workspaceId] === 'checkout') ? 'checkout' : 'tags';

  const setGrouping = useCallback((next: SessionGrouping) => {
    if (!workspaceId) return;
    setStored((previous) => {
      const updated = { ...previous, [workspaceId]: next };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Storage unavailable: the choice lasts for this page load.
      }
      return updated;
    });
  }, [workspaceId]);

  return [grouping, setGrouping];
}
