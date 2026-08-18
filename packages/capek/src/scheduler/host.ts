import type { CreateScheduledJobInput, ScheduledJob, UpdateScheduledJobInput } from '@capekai/types';

export interface SchedulerHost {
  create(workspaceId: string, input: CreateScheduledJobInput): ScheduledJob;
  get(id: string): ScheduledJob | null;
  list(workspaceId: string): ScheduledJob[];
  update(id: string, updates: UpdateScheduledJobInput): ScheduledJob | null;
  delete(id: string): boolean;
  trigger(job: ScheduledJob): void;
}

const defaultHost: SchedulerHost = {
  create() { throw new Error('Scheduler host is not configured'); },
  get: () => null,
  list: () => [],
  update: () => null,
  delete: () => false,
  trigger: () => {},
};
let host = defaultHost;
export function configureSchedulerHost(value?: SchedulerHost): void { host = value ?? defaultHost; }
export function getSchedulerHost(): SchedulerHost { return host; }
