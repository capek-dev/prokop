import type { SessionHarness, Workspace } from '@prokopai/sdk';
import type { KnowledgeJournalResult } from '@/application/learning/knowledge-journal';
import type { LearningReviewRunnerDependencies } from '@/application/learning/review-runner';

/** Knowledge destinations a learning runtime manages. */
export interface LearningKnowledgeDirectories {
  memoryDirectory: string;
  skillsDirectory: string;
}

/** One bounded review execution; the review-runner contract verbatim. */
export type LearningReviewExecution = LearningReviewRunnerDependencies['execute'];

/** Recovery and user-requested undo over a run's recorded destination. */
export interface LearningHistoryRuntime {
  undo(workspaceId: string, runId: string, changeId: string): Promise<KnowledgeJournalResult>;
  reconcile(workspaceId: string, runId: string, changeId: string): Promise<KnowledgeJournalResult>;
}

/**
 * Per-harness learning runtime (S11.3 slice 4).
 *
 * The application owns learning orchestration (discovery, eligibility,
 * review runs, recovery); the owning harness supplies the runtime that
 * executes reviews inside its own scope, resolves the knowledge
 * destinations it manages, and reconciles history for those destinations.
 * The assembly methods take the persistence handles the caller already
 * owns, so no harness or infrastructure type crosses this boundary:
 * Repository and Database are generic parameters the harness
 * instantiation fixes.
 */
export interface LearningRuntimePort<Repository = unknown, Database = unknown> {
  /** Harness identity stamped on learning-created sessions. */
  harness: SessionHarness;
  directories(workspace: Workspace): Promise<LearningKnowledgeDirectories>;
  createHistory(deps: {
    repository: Repository;
    workspace(id: string): Workspace | null;
    directories(workspace: Workspace): Promise<LearningKnowledgeDirectories>;
    now(): number;
  }): LearningHistoryRuntime;
  createExecution(deps: {
    database: Database;
    repository: Repository;
    workspace(id: string): Workspace | null;
    directories(workspace: Workspace): Promise<LearningKnowledgeDirectories>;
    createSession(workspace: Workspace, preconfigId: string, runId: string): string;
  }): LearningReviewExecution;
}
