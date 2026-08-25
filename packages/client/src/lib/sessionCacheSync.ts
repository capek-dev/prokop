import { queryClient } from '@/components/providers/QueryProvider';
import { useSessionStore } from '@/stores/sessionStore';
import { queryKeys } from '@/lib/queryKeys';
import { dedupeAndSortSessions } from '@/lib/sessionUtils';
import type { Session } from '@prokopai/sdk';

let unsubscribe: (() => void) | null = null;

function getWorkspaceId(key: readonly unknown[]): string | null {
  if (
    key[0] !== queryKeys.sessions.all[0] ||
    key[1] !== 'workspace' ||
    key[2] !== 'infinite'
  ) {
    return null;
  }
  const options = key[3];
  if (typeof options !== 'object' || options === null) return null;
  if (!('workspaceId' in options)) return null;
  if (typeof options.workspaceId !== 'string') return null;
  return options.workspaceId;
}

export function startSessionCacheSync(): void {
  if (unsubscribe) return;
  unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    const workspaceId = getWorkspaceId(event.query.queryKey);
    if (workspaceId === null) return;

    if (event.type === 'updated') {
      const data = event.query.state.data as
        | { pages?: Array<{ sessions?: Session[] }> }
        | undefined;
      if (!data) return;
      const sessions = (data.pages ?? []).flatMap((page) => page.sessions ?? []);
      useSessionStore.getState().replaceSessionsForWorkspace(
        workspaceId,
        dedupeAndSortSessions(sessions),
      );
    } else {
      useSessionStore.getState().removeSessionsForWorkspace(workspaceId);
    }
  });
}

export function stopSessionCacheSync(): void {
  unsubscribe?.();
  unsubscribe = null;
}
