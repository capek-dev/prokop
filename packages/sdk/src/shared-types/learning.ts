export interface LearningRunSummary {
  id: string;
  reviewerId: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: number;
  error: string | null;
  resolved: boolean;
  /** Automatic recovery preserves unfinished evidence and does not disable undo. */
  recovered?: boolean;
}

export interface LearningChange {
  id: string;
  path: string;
  before: string | null;
  after: string | null;
  status: 'prepared' | 'applied' | 'conflict' | 'undone';
  undoPending: boolean;
}

export interface LearningRunDetail {
  run: LearningRunSummary;
  changes: LearningChange[];
  sources: Array<{ sessionId: string; messageId: string }>;
  revision: string;
}

export type LearningScope = 'workspace' | 'agent';

/** Null on the reviewer means inherit the preconfig's current selection. */
export interface LearningModelOverride {
  providerId: string;
  modelId: string;
  variant?: string | null;
}

export interface LearningCadence {
  idleMinutes: number;
  minimumIntervalMinutes: number;
  maximumPendingMinutes: number;
}

export interface LearningReviewer {
  /** Stable identity for checkpoints, independent of the preconfig selection. */
  id: string;
  preconfigId: string;
  instructions: string;
  modelOverride: LearningModelOverride | null;
  /** Null uses the scope's default cadence. */
  cadence: LearningCadence | null;
}

export type LearningSources =
  | { mode: 'all' }
  | { mode: 'selected'; workspaceIds: string[] };

export interface WorkspaceLearningSettings {
  enabled: boolean;
  reviewers: LearningReviewer[];
  /** Also requires the scope's skill-management capability. */
  improveSkills: boolean;
  instructions: string;
  /** Used only for agent-home learning; source workspace privacy wins. */
  sources: LearningSources;
}

/** User-controlled eligibility, separate from server-owned run origin. */
export interface SessionLearningSettings {
  excluded: boolean;
  includeAutomated: boolean;
}
