import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

/**
 * A workspace's scheduled jobs changed on the server (an edit from any
 * client, a run, an error, a schedule advance). Replaces polling; jobs
 * missed while disconnected refetch with every query on reconnect.
 */
export function handleSchedulerChanged(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || !workspaceId) return;
  void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledJobs.byWorkspace(workspaceId) });
}
