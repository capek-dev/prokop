import type {
  CreateScheduledJobInput,
  ScheduledJob,
  UpdateScheduledJobInput,
} from '@jean2/sdk';
import type { ScheduledJobRepositoryPort } from '@/application/ports/scheduling';
import { createScheduledJobRepository } from '@/infrastructure/sqlite/scheduled-job-repository';
import { getDatabase } from './index';

/**
 * S5 compatibility module. The scheduled-job persistence implementation
 * moved to `infrastructure/sqlite/scheduled-job-repository.ts`; this module
 * keeps every pre-S5 export identity and forwards to a lazily created
 * repository over the current store database accessor, so test database
 * reconfiguration keeps working. Removed when consumers migrate.
 */

let repository: ScheduledJobRepositoryPort | null = null;

function getRepository(): ScheduledJobRepositoryPort {
  if (!repository) {
    repository = createScheduledJobRepository(() => getDatabase());
  }
  return repository;
}

export function createScheduledJob(
  workspaceId: string,
  input: CreateScheduledJobInput,
): ScheduledJob {
  return getRepository().create(workspaceId, input);
}

export function getScheduledJob(id: string): ScheduledJob | null {
  return getRepository().get(id);
}

export function listScheduledJobs(workspaceId: string): ScheduledJob[] {
  return getRepository().list(workspaceId);
}

export function updateScheduledJob(
  id: string,
  updates: UpdateScheduledJobInput,
): ScheduledJob | null {
  return getRepository().update(id, updates);
}

export function deleteScheduledJob(id: string): boolean {
  return getRepository().delete(id);
}

export function deleteScheduledJobsByWorkspace(workspaceId: string): number {
  return getRepository().deleteByWorkspace(workspaceId);
}

export function getDueScheduledJobs(now: number): ScheduledJob[] {
  return getRepository().getDue(now);
}

export function markScheduledJobRun(id: string, sessionId: string): void {
  getRepository().markRun(id, sessionId);
}

export function markScheduledJobError(id: string, error: string): void {
  getRepository().markError(id, error);
}

export function advanceScheduledJob(id: string): void {
  getRepository().advance(id);
}

export function markScheduledJobCompleted(id: string): void {
  getRepository().markCompleted(id);
}
