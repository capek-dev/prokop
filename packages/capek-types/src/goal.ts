/**
 * Goal mode types — persistent task loop with completion condition.
 */

/** The status of a goal loop. */
export type GoalStatus = 'active' | 'met' | 'failed' | 'cancelled';

/** Persistent goal state stored on session.metadata.goal. */
export interface GoalState {
  /** The completion condition the agent must satisfy. */
  condition: string;
  /** Maximum number of turns before giving up. */
  maxTurns: number;
  /** Current turn (0 = not started, 1+ = running). */
  currentTurn: number;
  /** Lifecycle status of the goal. */
  status: GoalStatus;
  /** When the goal was started (Unix ms). */
  startedAt: number;
  /** When the goal completed (Unix ms). */
  completedAt?: number;
}

/** Result from the goal evaluator LLM call. */
export interface GoalEvaluation {
  /** Whether the completion condition has been met. */
  goalMet: boolean;
  /** Explanation of the evaluation. */
  reason: string;
  /** Description of remaining work if not met. */
  remainingWork?: string;
}
