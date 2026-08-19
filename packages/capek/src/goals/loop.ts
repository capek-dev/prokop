import type { GoalState, Session } from '@capekai/types';
import { emitSessionUpdated } from '../runtime/host-dependencies';
import { getSession, updateSession } from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import {
  buildContinuationMessage,
  evaluateGoal,
  evaluateGoalWithDeps,
  type EvaluateGoalOptions,
} from './evaluator';

/**
 * Goal domain: the persistent goal loop. Moved byte-for-byte from
 * `core/goal-loop.ts`; the unscoped export keeps the pre-C5 module path
 * (module storage, module broadcast, module evaluator), and
 * `runGoalLoopWithDeps` runs against the injected session access, goal
 * state updates, evaluator, and broadcast defaults captured by the goal
 * domain plugin. Goal state stays on `session.metadata.goal` with the exact
 * lifecycle transitions: active, met, failed, cancelled.
 */

export type RunTurnFn = (content: string) => Promise<{ streamCompleted: boolean; interrupted: boolean }>;

export interface GoalLoopOptions {
  sessionId: string;
  condition: string;
  initialPrompt?: string;
  maxTurns?: number;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  runTurn: RunTurnFn;
  evaluate?: typeof evaluateGoal;
}

export interface GoalLoopDeps {
  getSession(id: string): Session | null | Promise<Session | null>;
  updateSession(id: string, updates: Partial<Session>): Session | null | Promise<Session | null>;
  evaluate(options: EvaluateGoalOptions): ReturnType<typeof evaluateGoalWithDeps>;
  broadcastSessionUpdatedDefault(session: Session): void;
}

async function updateGoalStateWithDeps(
  deps: GoalLoopDeps,
  sessionId: string,
  updates: Partial<GoalState>,
  broadcastSessionUpdatedFn?: BroadcastSessionFn,
): Promise<void> {
  const session = await deps.getSession(sessionId);
  if (!session) return;
  const metadata = session.metadata ?? {};
  const existingGoal = metadata.goal as GoalState | undefined;
  if (!existingGoal) return;
  const updated = await deps.updateSession(sessionId, { metadata: { ...metadata, goal: { ...existingGoal, ...updates } } });
  if (updated) (broadcastSessionUpdatedFn ?? deps.broadcastSessionUpdatedDefault)(updated);
}

/** Unscoped goal loop: the pre-C5 module accessors. */
export async function runGoalLoop(options: GoalLoopOptions): Promise<void> {
  return runGoalLoopWithDeps(options, {
    getSession,
    updateSession,
    evaluate: (evaluateOptions) => evaluateGoal(evaluateOptions),
    broadcastSessionUpdatedDefault: emitSessionUpdated,
  });
}

/** Composed goal loop over the dependencies captured by the goal domain
 * plugin. */
export async function runGoalLoopWithDeps(
  options: GoalLoopOptions,
  deps: GoalLoopDeps,
): Promise<void> {
  const maxTurns = options.maxTurns ?? 5;
  const {
    sessionId,
    condition,
    initialPrompt,
    abortSignal,
    broadcast,
    broadcastSessionCreated,
    broadcastSessionUpdated: broadcastSessUpdated,
    runTurn,
    evaluate = (evaluateOptions: EvaluateGoalOptions) => deps.evaluate(evaluateOptions),
  } = options;

  console.log('[goal:loop] Starting goal loop', {
    sessionId,
    conditionPreview: condition.slice(0, 80),
    maxTurns,
    hasInitialPrompt: !!initialPrompt,
  });

  const session = await deps.getSession(sessionId);
  if (!session) {
    console.error('[goal:loop] Session not found', { sessionId });
    return;
  }
  const goalState: GoalState = {
    condition,
    maxTurns,
    currentTurn: 0,
    status: 'active',
    startedAt: Date.now(),
  };
  const initialized = await deps.updateSession(sessionId, { metadata: { ...(session.metadata ?? {}), goal: goalState } });
  if (initialized) (broadcastSessUpdated ?? deps.broadcastSessionUpdatedDefault)(initialized);

  let nextTurnContent = initialPrompt || condition;
  for (let turn = 1; turn <= maxTurns; turn++) {
    if (abortSignal?.aborted) {
      console.log('[goal:loop] Aborted before turn', { turn });
      await updateGoalStateWithDeps(deps, sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }
    await updateGoalStateWithDeps(deps, sessionId, { currentTurn: turn }, broadcastSessUpdated);
    console.log('[goal:loop] Starting turn', { turn, maxTurns, contentPreview: nextTurnContent.slice(0, 80) });

    const result = await runTurn(nextTurnContent);
    console.log('[goal:loop] Turn completed', { turn, streamCompleted: result.streamCompleted, interrupted: result.interrupted });

    if (result.interrupted) {
      console.log('[goal:loop] Turn was interrupted, stopping goal loop', { turn });
      await updateGoalStateWithDeps(deps, sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }

    if (!result.streamCompleted) {
      console.log('[goal:loop] Turn stream did not complete, stopping goal loop', { turn });
      await updateGoalStateWithDeps(deps, sessionId, { status: 'failed', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }

    if (abortSignal?.aborted) {
      console.log('[goal:loop] Aborted after turn', { turn });
      await updateGoalStateWithDeps(deps, sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }

    let evaluation;
    try {
      evaluation = await evaluate({
        sessionId,
        condition,
        turn,
        maxTurns,
        abortSignal,
        broadcast,
        broadcastSessionCreated,
        broadcastSessionUpdated: broadcastSessUpdated,
      });
    } catch (err) {
      console.error('[goal:loop] Evaluator failed', { turn, error: err instanceof Error ? err.message : String(err) });
      evaluation = { goalMet: false, reason: 'Evaluator call failed — continuing work' };
    }
    if (evaluation.goalMet) {
      console.log('[goal:loop] GOAL MET!', { turn, reason: evaluation.reason });
      await updateGoalStateWithDeps(deps, sessionId, { status: 'met', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }
    nextTurnContent = buildContinuationMessage(condition, evaluation.reason, evaluation.remainingWork);
    console.log('[goal:loop] Prepared continuation for next turn', { turn, continuationPreview: nextTurnContent.slice(0, 80) });
  }
  console.log('[goal:loop] Max turns reached without meeting goal', { maxTurns });
  await updateGoalStateWithDeps(deps, sessionId, { status: 'failed', completedAt: Date.now() }, broadcastSessUpdated);
}
