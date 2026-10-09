import { createContext, useContext } from 'react';
import type { UseServerSessionManagerReturn } from '@/hooks/useServerSessionManager';
import type { SessionCommandsValue } from '@/contexts/SessionCommandsContext';

/**
 * Stable commands plus the few slow-changing values views need. Reactive
 * session state (sessions, usage, asks, streaming) is read from stores by the
 * component that renders it, so one session's update never re-renders the
 * whole workspace.
 */
export type SessionManagerValue = SessionCommandsValue & Pick<
  UseServerSessionManagerReturn,
  | 'sdkClient'
  | 'serverUrl'
  | 'primaryPreconfigs'
  | 'isCreatingWorkspace'
  | 'deletingWorkspaceId'
  | 'isUpdatingWorkspace'
  | 'setCompactionSuccess'
>;

export const SessionManagerContext = createContext<SessionManagerValue | null>(null);

export function useSessionManager(): SessionManagerValue {
  const ctx = useContext(SessionManagerContext);
  if (!ctx) {
    throw new Error('useSessionManager must be used within a SessionManagerContext.Provider');
  }
  return ctx;
}
