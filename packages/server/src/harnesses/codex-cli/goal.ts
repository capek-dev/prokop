import type { CodexGoalState, Session } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { codexObject } from './app-server';

const GOAL_STATUSES = new Set(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete']);
export const MAX_CODEX_GOAL_BUDGET = 1_000_000;

export function validGoalBudget(budget: unknown): budget is number {
  return typeof budget === 'number' && Number.isSafeInteger(budget)
    && budget > 0 && budget <= MAX_CODEX_GOAL_BUDGET;
}

export function parseCodexGoal(raw: unknown, threadId: string): CodexGoalState | null {
  const goal = codexObject(raw);
  if (!goal || goal.threadId !== threadId || typeof goal.objective !== 'string'
    || !goal.objective.trim() || !GOAL_STATUSES.has(String(goal.status))
    || (goal.tokenBudget !== null && !validGoalBudget(goal.tokenBudget))
    || typeof goal.tokensUsed !== 'number' || !Number.isSafeInteger(goal.tokensUsed) || goal.tokensUsed < 0) return null;
  return { objective: goal.objective, status: goal.status as CodexGoalState['status'],
    tokenBudget: goal.tokenBudget, tokensUsed: goal.tokensUsed };
}

export function publishCodexGoal(session: Session, goal: CodexGoalState | null,
  delivery: ApplicationDeliveryPort<unknown>): void {
  const latest = getSession(session.id);
  if (!latest || latest.harness !== 'codex-cli') return;
  const { codexGoalPending: pending, ...current } = codexObject(latest.metadata) ?? {};
  const updated = updateSession(session.id, { metadata: {
    ...current, codexGoal: goal, ...(goal === null && pending !== undefined ? { codexGoalPending: pending } : {}),
  } });
  if (updated) delivery.broadcastToSession(session.id, { type: 'session.updated', session: updated });
}

export function goalIsTerminal(goal: CodexGoalState): boolean {
  return goal.status !== 'active';
}
