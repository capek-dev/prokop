/**
 * C6 pinned compatibility forwarder. The compaction policy service and task
 * pipeline moved to `compaction/` (`policy.ts` owns policy resolution, the
 * threshold formula, the failure cooldown, the replay selection, and the
 * concurrency guard; `task.ts` owns trigger creation, summary generation,
 * pruning, and failure persistence). This module re-exports ONLY the exact
 * pre-C6 export surface so `core/agent.ts`, `core/chat-handler.ts`, and
 * `internal/execution.ts` keep working unchanged. The recovery entrypoints
 * deliberately stay out of this forwarder: they are new deps-based domain
 * functions with no pre-C6 compatible signature, so they are not presented
 * as compatibility exports. `getCompactionService` is the one additive
 * accessor: the core chat handler consumes the scoped service through this
 * forwarder (pinned by the `compaction-domain-no-core` AST gates), so the
 * forwarder must re-export it.
 */

export {
  buildConversationText,
  createCompactionTrigger,
  estimateToolOutputSize,
  formatOutput,
  persistCompactionFailure,
  processCompactionTask,
} from '../compaction/task';
export {
  getDefaultCompactionPolicy,
  getCompactionService,
  resolveCompactionPolicy,
} from '../compaction/policy';
export type {
  CompactionPolicy,
  CompactionTaskResult,
  CompactionTrigger,
  CompactionTriggerReason,
  GenerateSummaryFn,
} from '../compaction/contracts';
