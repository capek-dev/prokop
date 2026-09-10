import type { LearningRepository } from '@/infrastructure/sqlite/learning-repository';

/** Called only after execution cleanup, or at startup before accepting traffic.
 * Recovery never applies old write intents. Fresh reviews read current knowledge. */
export function createLearningRecovery(deps: {
  repository: LearningRepository;
  reconcile(workspaceId: string, runId: string, changeId: string): Promise<unknown>;
  now(): number;
  onError(error: unknown): void;
}) {
  return async (workspaceId: string): Promise<void> => {
    if (deps.repository.activeRun(workspaceId)) return;
    for (;;) {
      const runs = deps.repository.recoveryCandidates(workspaceId);
      if (!runs.length) return;
      for (const run of runs) {
        for (const change of deps.repository.changes(run.id)) {
          if (change.status !== 'prepared' && !deps.repository.hasUndoIntent(change.id)) continue;
          try { await deps.reconcile(workspaceId, run.id, change.id); }
          catch (error: unknown) {
            // Missing/moved paths cannot authorize a read. Preserve bytes and
            // retire that operation, rather than redirecting it or blocking learning.
            deps.onError(error);
          }
        }
        deps.repository.completeRecovery(run.id, deps.now());
      }
    }
  };
}
