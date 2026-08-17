import type {
  AutoApproveSeverity,
  CreateScheduledJobInput,
  Preconfig,
  ScheduledJob,
  Session,
  UpdateScheduledJobInput,
  Workspace,
} from '@jean2/sdk';

/**
 * Repository port for scheduled-job persistence. Structural copy of the
 * current store function surface; the infrastructure SQLite implementation
 * and the Jean2 store compatibility adapter both fulfill it.
 */
export interface ScheduledJobRepositoryPort {
  create(workspaceId: string, input: CreateScheduledJobInput): ScheduledJob;
  get(id: string): ScheduledJob | null;
  list(workspaceId: string): ScheduledJob[];
  update(id: string, updates: UpdateScheduledJobInput): ScheduledJob | null;
  delete(id: string): boolean;
  deleteByWorkspace(workspaceId: string): number;
  getDue(now: number): ScheduledJob[];
  markRun(id: string, sessionId: string): void;
  markError(id: string, error: string): void;
  advance(id: string): void;
  markCompleted(id: string): void;
}

/** Workspace lookups the scheduling use cases need. The Jean2 storage
 * adapter fulfills this port; use cases never touch workspace SQL. */
export interface ScheduledJobWorkspacePort {
  getWorkspace(id: string): Workspace | null;
}

/**
 * Execution port for scheduled-job runs. `run` awaits the current runner
 * implementation; `trigger` is the fire-and-forget HTTP trigger path with
 * the manual-trigger error log.
 */
export interface ScheduledJobExecutionPort {
  run(job: ScheduledJob): Promise<void>;
  trigger(job: ScheduledJob): void;
}

export interface ScheduledRunSessionPort {
  createSession(
    session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string },
  ): Session;
  getSession(id: string): Session | null;
}

export interface ScheduledRunWorkspacePort {
  getWorkspace(id: string): Workspace | null;
  getAutoApproveSeverity(id: string): AutoApproveSeverity;
}

export interface ScheduledRunPreconfigPort {
  getPreconfig(id: string): Promise<Preconfig | null>;
  getDefaultPreconfig(): Promise<Preconfig | null>;
}

export interface ScheduledRunModelsConfigPort {
  getModelsConfig(): { defaultModel: string; defaultProvider: string };
}
