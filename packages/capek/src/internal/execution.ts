/**
 * Internal execution entrypoint (`@capekai/core/internal/execution`).
 *
 * Exposes exactly the agent execution identities the Jean2 server consumes
 * through its execution port: chat, edit, title regeneration, compaction,
 * fork, revert, and the interrupt manager. Every symbol resolves to the
 * owning module's identity, identical to the compatibility barrel. S8a.
 */

export {
  handleChat,
  handleSessionEditMessage,
  regenerateSessionTitle,
  type RuntimeRequestContext,
} from '../core/chat-handler';
export { interruptManager } from '../core/interrupt';
export { forkSession } from '../core/fork';
export { revertToStep } from '../core/revert';
export { executeCompaction } from '../compaction/executor';
export {
  reconcileAllSessionsCompaction as reconcileAllSessionsCompactionWithDeps,
  reconcileSessionCompaction as reconcileSessionCompactionWithDeps,
  type CompactionRecoveryDeps,
} from '../compaction/recovery';
export type { RuntimeEventSink } from '../runtime/events';
