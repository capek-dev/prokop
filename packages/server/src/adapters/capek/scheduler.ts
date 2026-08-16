import {
  configureSchedulerHost,
  type SchedulerHost,
} from '@capekai/core/compat/jean2';
import {
  createScheduledJob,
  deleteScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from '@/store/scheduled-jobs';
import { runScheduledJob } from '@/scheduler/runner';

export const jean2SchedulerHost: SchedulerHost = {
  create: createScheduledJob,
  get: getScheduledJob,
  list: listScheduledJobs,
  update: updateScheduledJob,
  delete: deleteScheduledJob,
  trigger(job) {
    runScheduledJob(job).catch((error: unknown) => {
      console.error(`[scheduler-tool] Trigger of '${job.name}' failed:`, error);
    });
  },
};

export function configureJean2SchedulerHost(): void {
  configureSchedulerHost(jean2SchedulerHost);
}
