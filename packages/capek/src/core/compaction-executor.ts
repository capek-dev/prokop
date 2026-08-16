/**
 * C6 pinned compatibility forwarder. The compaction executor moved to
 * `compaction/executor.ts` with scope-owned concurrency state; every prior
 * export resolves to the same function or type identity.
 */

export {
  executeCompaction,
  isCompactionActive,
} from '../compaction/executor';
export type {
  CompactionExecutorError,
  CompactionExecutorResult,
} from '../compaction/executor';
