import type {
  CreateScheduledJobInput,
  ScheduledJob,
  UpdateScheduledJobInput,
} from '@prokopai/sdk';
import type {
  ScheduledJobExecutionPort,
  ScheduledJobRepositoryPort,
  ScheduledJobWorkspacePort,
} from '../ports/scheduling';

export type SchedulingCreateResult =
  | { kind: 'created'; job: ScheduledJob }
  | { kind: 'workspace_not_found' };

export interface SchedulingApplicationDeps {
  repository: ScheduledJobRepositoryPort;
  workspaces: ScheduledJobWorkspacePort;
  execution: ScheduledJobExecutionPort;
}

/**
 * Scheduled-job HTTP use cases. Owns the use-case input shaping (name and
 * prompt trimming, default normalization), the create-time workspace
 * existence check, the pause/resume state commands, and the manual-trigger
 * fire-and-forget policy. Transport maps the discriminated results to HTTP
 * statuses exactly as before.
 */
export interface SchedulingHttpApplication {
  listJobs(workspaceId: string): ScheduledJob[];
  getJob(id: string): ScheduledJob | null;
  createJob(workspaceId: string, input: CreateScheduledJobInput): SchedulingCreateResult;
  updateJob(id: string, updates: UpdateScheduledJobInput): ScheduledJob | null;
  deleteJob(id: string): boolean;
  pauseJob(id: string): ScheduledJob | null;
  resumeJob(id: string): ScheduledJob | null;
  triggerJob(id: string): ScheduledJob | null;
  deleteJobsByWorkspace(workspaceId: string): number;
}

export function createSchedulingHttpApplication(
  deps: SchedulingApplicationDeps,
): SchedulingHttpApplication {
  return {
    listJobs(workspaceId) {
      return deps.repository.list(workspaceId);
    },

    getJob(id) {
      return deps.repository.get(id);
    },

    createJob(workspaceId, input) {
      if (!deps.workspaces.getWorkspace(workspaceId)) {
        return { kind: 'workspace_not_found' };
      }
      return {
        kind: 'created',
        job: deps.repository.create(workspaceId, {
          ...input,
          name: input.name.trim(),
          prompt: input.prompt.trim(),
          repeatLimit: input.repeatLimit ?? null,
          reuseSession: input.reuseSession ?? false,
          includeHistory: input.includeHistory ?? false,
          preconfigId: input.preconfigId ?? null,
          originSessionId: input.originSessionId ?? null,
          autoApproveSeverity: input.autoApproveSeverity ?? null,
          notificationsEnabled: input.notificationsEnabled ?? false,
        }),
      };
    },

    updateJob(id, updates) {
      return deps.repository.update(id, updates);
    },

    deleteJob(id) {
      return deps.repository.delete(id);
    },

    pauseJob(id) {
      return deps.repository.update(id, { state: 'paused' });
    },

    resumeJob(id) {
      return deps.repository.update(id, { state: 'active' });
    },

    triggerJob(id) {
      const job = deps.repository.get(id);
      if (!job) {
        return null;
      }
      deps.execution.trigger(job);
      return job;
    },

    deleteJobsByWorkspace(workspaceId) {
      return deps.repository.deleteByWorkspace(workspaceId);
    },
  };
}
