import type { LearningChangeRecord, LearningRepository } from '@/infrastructure/sqlite/learning-repository';

export interface KnowledgeFilePort {
  read(relativePath: string): Promise<string | null>;
  /** Must serialize with all managed knowledge writers and reject symlinks.
   * Comparison and replacement are one protected operation, not read then write. */
  compareAndSwap(relativePath: string, expected: string | null, replacement: string | null): Promise<boolean>;
}

export interface KnowledgeJournalDependencies {
  repository: Pick<LearningRepository, 'prepareChange' | 'transitionChange' | 'changes' | 'getRun' | 'hasUndoIntent' | 'prepareUndo' | 'finishUndo'>;
  files: KnowledgeFilePort;
  now(): number;
  /** Rechecks run identity, source eligibility, settings, and cancellation. */
  authorize(runId: string, purpose: 'apply' | 'undo' | 'recover'): Promise<void>;
}

export type KnowledgeJournalResult = 'applied' | 'undone' | 'unchanged' | 'conflict';

/** The database records intent before file activation. Failed CAS never overwrites
 * foreground edits. Prepared rows survive crashes for explicit reconciliation. */
export function createKnowledgeJournal(deps: KnowledgeJournalDependencies) {
  function find(runId: string, changeId: string): LearningChangeRecord {
    const change = deps.repository.changes(runId).find(item => item.id === changeId);
    if (!change) throw new Error('Learning change not found');
    return change;
  }

  function transition(change: LearningChangeRecord, to: LearningChangeRecord['status']): void {
    if (!deps.repository.transitionChange(change.id, change.status, to)) {
      throw new Error('Learning change state changed concurrently');
    }
  }

  return {
    async apply(input: {
      runId: string;
      operationId: string;
      relativePath: string;
      before: string | null;
      after: string | null;
    }): Promise<KnowledgeJournalResult> {
      await deps.authorize(input.runId, 'apply');
      if (input.before === input.after) return 'unchanged';
      const change = deps.repository.prepareChange({
        run_id: input.runId, operation_id: input.operationId,
        relative_path: input.relativePath, before_content: input.before,
        after_content: input.after, created_at: deps.now(),
      });
      // Never reactivate a previously applied/undone operation on retry.
      if (change.status === 'applied') return 'applied';
      if (change.status === 'undone') return 'undone';
      if (change.status === 'conflict') return 'conflict';
      await deps.authorize(input.runId, 'apply');
      if (!await deps.files.compareAndSwap(change.relative_path, change.before_content, change.after_content)) {
        transition(change, 'conflict');
        return 'conflict';
      }
      transition(change, 'applied');
      return 'applied';
    },

    async undo(runId: string, changeId: string): Promise<KnowledgeJournalResult> {
      await deps.authorize(runId, 'undo');
      const run = deps.repository.getRun(runId);
      if (!run || run.status === 'running') throw new Error('Cannot undo an active learning run');
      const change = find(runId, changeId);
      if (change.status === 'undone') return 'undone';
      if (change.status !== 'applied') return 'conflict';
      if (!deps.repository.prepareUndo(change.id, deps.now())) return 'conflict';
      // Intent survives a crash between file replacement and database completion.
      const swapped = await deps.files.compareAndSwap(change.relative_path, change.after_content, change.before_content);
      if (!deps.repository.finishUndo(change.id, swapped)) throw new Error('Undo requires reconciliation');
      if (!swapped) return 'conflict';
      return 'undone';
    },

    async reconcile(runId: string, changeId: string): Promise<KnowledgeJournalResult> {
      await deps.authorize(runId, 'recover');
      const run = deps.repository.getRun(runId);
      if (!run || run.status === 'running') throw new Error('Stop the learning writer before recovery');
      const change = find(runId, changeId);
      if (deps.repository.hasUndoIntent(change.id)) {
        const current = await deps.files.read(change.relative_path);
        if (current === change.before_content) {
          if (!deps.repository.finishUndo(change.id, true)) throw new Error('Undo reconciliation failed');
          return 'undone';
        }
        if (current === change.after_content) {
          deps.repository.finishUndo(change.id, false);
          return 'applied';
        }
        // Keep ambiguous undo intent pending, blocking new background writers.
        return 'conflict';
      }
      if (change.status === 'applied' || change.status === 'undone') return change.status;
      if (change.status === 'conflict') return 'conflict';
      const current = await deps.files.read(change.relative_path);
      if (current === change.after_content) {
        transition(change, 'applied');
        return 'applied';
      }
      // Recovery does not replay writes, even when the original content remains.
      // The source may have been excluded while the process was offline.
      transition(change, 'conflict');
      return 'conflict';
    },
  };
}
