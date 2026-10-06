import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';

/**
 * Reports every scheduled-job write (HTTP edits, pauses, runs, errors,
 * schedule advances) with its workspace, so clients refetch on change
 * instead of polling.
 */
export function withScheduledJobChangeNotices(
  repository: ScheduledJobRepositoryPort,
  changed: (workspaceId: string) => void,
): ScheduledJobRepositoryPort {
  const changedJob = (id: string): void => {
    const workspaceId = repository.get(id)?.workspaceId;
    if (workspaceId) changed(workspaceId);
  };
  return {
    ...repository,
    create(workspaceId, input) {
      const job = repository.create(workspaceId, input);
      changed(workspaceId);
      return job;
    },
    update(id, updates) {
      const job = repository.update(id, updates);
      if (job) changed(job.workspaceId);
      return job;
    },
    delete(id) {
      const workspaceId = repository.get(id)?.workspaceId;
      const deleted = repository.delete(id);
      if (deleted && workspaceId) changed(workspaceId);
      return deleted;
    },
    deleteByWorkspace(workspaceId) {
      const count = repository.deleteByWorkspace(workspaceId);
      if (count > 0) changed(workspaceId);
      return count;
    },
    markRun(id, sessionId) {
      repository.markRun(id, sessionId);
      changedJob(id);
    },
    markError(id, error) {
      repository.markError(id, error);
      changedJob(id);
    },
    advance(id) {
      repository.advance(id);
      changedJob(id);
    },
    markCompleted(id) {
      repository.markCompleted(id);
      changedJob(id);
    },
  };
}
