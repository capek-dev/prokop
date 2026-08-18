import {
  advanceScheduledJob,
  createScheduledJob,
  deleteScheduledJob,
  deleteScheduledJobsByWorkspace,
  getDueScheduledJobs,
  getScheduledJob,
  listScheduledJobs,
  markScheduledJobCompleted,
  markScheduledJobError,
  markScheduledJobRun,
  updateScheduledJob,
} from '@/infrastructure/sqlite/scheduled-job-store';
import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';

/**
 * Jean2 scheduled-job repository adapter over the store compatibility
 * module. The store module itself forwards to the SQLite infrastructure
 * repository; this adapter keeps the store import in the adapter layer only.
 */
export function createJean2ScheduledJobRepository(): ScheduledJobRepositoryPort {
  return {
    create: createScheduledJob,
    get: getScheduledJob,
    list: listScheduledJobs,
    update: updateScheduledJob,
    delete: deleteScheduledJob,
    deleteByWorkspace: deleteScheduledJobsByWorkspace,
    getDue: getDueScheduledJobs,
    markRun: markScheduledJobRun,
    markError: markScheduledJobError,
    advance: advanceScheduledJob,
    markCompleted: markScheduledJobCompleted,
  };
}
