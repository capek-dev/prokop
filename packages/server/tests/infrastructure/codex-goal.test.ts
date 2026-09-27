import { afterEach, beforeEach, expect, test } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { createSession, getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { goalIsTerminal, parseCodexGoal, publishCodexGoal, validGoalBudget } from '@/harnesses/codex-cli/goal';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import type { CodexGoalState, ServerMessage } from '@prokopai/sdk';

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

const rawGoal = {
  threadId: 'thread-1', objective: 'Ship it', status: 'active',
  tokenBudget: 50_000, tokensUsed: 300, timeUsedSeconds: 2, createdAt: 1, updatedAt: 2,
};

test('Codex budget and upstream goal shapes fail closed', () => {
  for (const value of [0, -1, 1.5, 1_000_001, NaN, Infinity, null, undefined, '10']) {
    expect(validGoalBudget(value)).toBe(false);
  }
  expect(validGoalBudget(1)).toBe(true);
  expect(validGoalBudget(1_000_000)).toBe(true);
  expect(parseCodexGoal(rawGoal, 'thread-1')).toEqual({
    objective: 'Ship it', status: 'active', tokenBudget: 50_000, tokensUsed: 300,
  });
  for (const patch of [
    { threadId: 'wrong' }, { objective: '' }, { objective: null }, { status: 'unknown' },
    { tokenBudget: -1 }, { tokenBudget: 1_000_001 }, { tokenBudget: '100' },
    { tokensUsed: -1 }, { tokensUsed: 0.5 }, { tokensUsed: '300' },
  ]) {
    expect(parseCodexGoal({ ...rawGoal, ...patch }, 'thread-1')).toBeNull();
  }
  expect(parseCodexGoal(null, 'thread-1')).toBeNull();
  expect(parseCodexGoal({ ...rawGoal, tokenBudget: null }, 'thread-1')?.tokenBudget).toBeNull();
});

test('Codex goal status is terminal only when upstream stops continuation', () => {
  for (const status of ['paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'] as const) {
    expect(goalIsTerminal({ ...rawGoal, status } as CodexGoalState)).toBe(true);
  }
  expect(goalIsTerminal(rawGoal as CodexGoalState)).toBe(false);
});

test('goal metadata publication preserves other metadata and broadcasts session update', () => {
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'codex-cli' });
  const session = updateSession('s', { metadata: { other: 'kept' } })!;
  const messages: ServerMessage[] = [];
  const delivery = {
    broadcastToSession: (_id: string, message: ServerMessage) => { messages.push(message); },
  } as ApplicationDeliveryPort<unknown>;
  const goal = parseCodexGoal(rawGoal, 'thread-1')!;
  updateSession('s', { metadata: { other: 'kept', newer: true } });
  publishCodexGoal(session, goal, delivery);
  expect(getSession('s')?.metadata).toEqual({ other: 'kept', newer: true, codexGoal: goal });
  expect(messages).toMatchObject([{ type: 'session.updated', session: { metadata: { other: 'kept', newer: true, codexGoal: goal } } }]);
});
