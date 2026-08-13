import type { GoalState } from '@jean2/sdk';
import { broadcastSessionUpdated } from '../compat/jean2-dependencies';
import { getSession, updateSession } from '../storage/runtime';
import type { BroadcastFn, BroadcastSessionFn } from '../compat/bindings';
import { buildContinuationMessage, evaluateGoal } from './goal-evaluator';

function updateGoalState(
  sessionId: string,
  updates: Partial<GoalState>,
  broadcastSessionUpdatedFn?: BroadcastSessionFn,
): void {
  const session = getSession(sessionId);
  if (!session) return;
  const metadata = session.metadata ?? {};
  const existingGoal = metadata.goal as GoalState | undefined;
  if (!existingGoal) return;
  updateSession(sessionId, { metadata: { ...metadata, goal: { ...existingGoal, ...updates } } });
  const updated = getSession(sessionId);
  if (updated) (broadcastSessionUpdatedFn ?? broadcastSessionUpdated)(updated);
}

export type RunTurnFn = (content: string) => Promise<{ streamCompleted: boolean; interrupted: boolean }>;

export async function runGoalLoop(options: {
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
}): Promise<void> {
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
    evaluate = evaluateGoal,
  } = options;

  console.log('[goal:loop] Starting goal loop', {
    sessionId,
    conditionPreview: condition.slice(0, 80),
    maxTurns,
    hasInitialPrompt: !!initialPrompt,
  });

  const session = getSession(sessionId);
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
  updateSession(sessionId, { metadata: { ...(session.metadata ?? {}), goal: goalState } });
  const initialized = getSession(sessionId);
  if (initialized) (broadcastSessUpdated ?? broadcastSessionUpdated)(initialized);

  let nextTurnContent = initialPrompt || condition;
  for (let turn = 1; turn <= maxTurns; turn++) {
    if (abortSignal?.aborted) {
      console.log('[goal:loop] Aborted before turn', { turn });
      updateGoalState(sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }
    updateGoalState(sessionId, { currentTurn: turn }, broadcastSessUpdated);
    console.log('[goal:loop] Starting turn', { turn, maxTurns, contentPreview: nextTurnContent.slice(0, 80) });

    const result = await runTurn(nextTurnContent);
    console.log('[goal:loop] Turn completed', { turn, streamCompleted: result.streamCompleted, interrupted: result.interrupted });

    if (result.interrupted) {
      console.log('[goal:loop] Turn was interrupted, stopping goal loop', { turn });
      updateGoalState(sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }

    if (!result.streamCompleted) {
      console.log('[goal:loop] Turn stream did not complete, stopping goal loop', { turn });
      updateGoalState(sessionId, { status: 'failed', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }

    if (abortSignal?.aborted) {
      console.log('[goal:loop] Aborted after turn', { turn });
      updateGoalState(sessionId, { status: 'cancelled', completedAt: Date.now() }, broadcastSessUpdated);
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
      updateGoalState(sessionId, { status: 'met', completedAt: Date.now() }, broadcastSessUpdated);
      return;
    }
    nextTurnContent = buildContinuationMessage(condition, evaluation.reason, evaluation.remainingWork);
    console.log('[goal:loop] Prepared continuation for next turn', { turn, continuationPreview: nextTurnContent.slice(0, 80) });
  }
  console.log('[goal:loop] Max turns reached without meeting goal', { maxTurns });
  updateGoalState(sessionId, { status: 'failed', completedAt: Date.now() }, broadcastSessUpdated);
}
