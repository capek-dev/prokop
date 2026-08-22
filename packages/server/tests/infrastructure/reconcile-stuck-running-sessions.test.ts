import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import {
  reconcileStuckRunningSessions,
  getSession,
  updateSession,
} from '@/infrastructure/sqlite/session-store';

describe('reconcileStuckRunningSessions', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const seeded = seedWorkspaceWithSession();
    sessionId = seeded.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('clears runningAt on stuck sessions and leaves others untouched', () => {
    updateSession(sessionId, { runningAt: new Date().toISOString() });

    const reconciled = reconcileStuckRunningSessions();

    expect(reconciled).toBe(1);
    expect(getSession(sessionId)?.runningAt).toBeNull();
  });

  test('flips subagent running status to interrupted', () => {
    updateSession(sessionId, { subagentStatus: 'running' });

    const reconciled = reconcileStuckRunningSessions();

    expect(reconciled).toBe(1);
    const session = getSession(sessionId);
    expect(session?.runningAt).toBeNull();
    expect(session?.subagentStatus).toBe('interrupted');
  });

  test('leaves idle sessions untouched', () => {
    updateSession(sessionId, { runningAt: null, subagentStatus: 'completed' });

    const reconciled = reconcileStuckRunningSessions();

    expect(reconciled).toBe(0);
    expect(getSession(sessionId)?.runningAt).toBeNull();
    expect(getSession(sessionId)?.subagentStatus).toBe('completed');
  });
});
