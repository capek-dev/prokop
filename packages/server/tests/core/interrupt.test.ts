import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { interruptManager } from '@/core/interrupt';

describe('InterruptManager', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const ctx = seedWorkspaceWithSession();
    sessionId = ctx.sessionId;
  });

  afterEach(() => {
    // Clean up any registered sessions
    resetTestDatabase();
  });

  test('registerSession returns AbortController', () => {
    const controller = interruptManager.registerSession(sessionId);
    expect(controller).toBeInstanceOf(AbortController);
    expect(interruptManager.isSessionActive(sessionId)).toBe(true);

    interruptManager.unregisterSession(sessionId);
  });

  test('unregisterSession removes context', () => {
    interruptManager.registerSession(sessionId);
    interruptManager.unregisterSession(sessionId);
    expect(interruptManager.isSessionActive(sessionId)).toBe(false);
  });

  test('isSessionActive returns false for unregistered session', () => {
    expect(interruptManager.isSessionActive('nonexistent')).toBe(false);
  });

  test('isSessionInterrupted returns false for unregistered session', () => {
    expect(interruptManager.isSessionInterrupted('nonexistent')).toBe(false);
  });

  test('interruptSession aborts controller and tools', async () => {
    const controller = interruptManager.registerSession(sessionId);
    const toolController = interruptManager.registerToolExecution(sessionId, 'tool-1');

    const result = await interruptManager.interruptSession(sessionId);

    expect(controller.signal.aborted).toBe(true);
    expect(toolController.signal.aborted).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.success).toBe(true);
    expect(result.interruptedTools).toContain('tool-1');

    interruptManager.unregisterSession(sessionId);
  });

  test('interruptSession returns success even for unregistered session', async () => {
    const result = await interruptManager.interruptSession('nonexistent');
    expect(result.success).toBe(true);
    expect(result.interruptedTools).toHaveLength(0);
  });

  test('registerToolExecution returns AbortController linked to session', async () => {
    const sessionController = interruptManager.registerSession(sessionId);
    const toolController = interruptManager.registerToolExecution(sessionId, 'tool-1');

    // Aborting the session should abort the tool
    sessionController.abort();
    expect(toolController.signal.aborted).toBe(true);

    interruptManager.unregisterSession(sessionId);
  });

  test('unregisterToolExecution removes tool context', () => {
    interruptManager.registerSession(sessionId);
    interruptManager.registerToolExecution(sessionId, 'tool-1');
    interruptManager.unregisterToolExecution(sessionId, 'tool-1');

    // After unregister, interrupting should not list the tool
    // (but the session controller still exists)
    interruptManager.unregisterSession(sessionId);
  });

  test('multiple tool executions can be registered and interrupted', async () => {
    interruptManager.registerSession(sessionId);
    interruptManager.registerToolExecution(sessionId, 'tool-1');
    interruptManager.registerToolExecution(sessionId, 'tool-2');

    const result = await interruptManager.interruptSession(sessionId);

    expect(result.interruptedTools).toHaveLength(2);
    expect(result.interruptedTools).toContain('tool-1');
    expect(result.interruptedTools).toContain('tool-2');

    interruptManager.unregisterSession(sessionId);
  });

  test('isSessionInterrupted returns true after interrupt', async () => {
    interruptManager.registerSession(sessionId);
    await interruptManager.interruptSession(sessionId);

    expect(interruptManager.isSessionInterrupted(sessionId)).toBe(true);
    expect(interruptManager.isSessionActive(sessionId)).toBe(false);

    interruptManager.unregisterSession(sessionId);
  });

  test('already aborted tools are not double-reported', async () => {
    interruptManager.registerSession(sessionId);
    const toolController = interruptManager.registerToolExecution(sessionId, 'tool-1');

    // Pre-abort the tool
    toolController.abort();

    const result = await interruptManager.interruptSession(sessionId);
    // Should not include already-aborted tool
    expect(result.interruptedTools).not.toContain('tool-1');

    interruptManager.unregisterSession(sessionId);
  });

  test('interrupt cascades to child sessions from DB', async () => {
    // Register parent session
    interruptManager.registerSession(sessionId);

    // The getChildSessions is called during interruptSession to cascade to children
    // We've seeded workspace+session, so we need a child session in the DB
    const { createSession } = await import('@/store/sessions');
    const { createTestSession } = await import('#tests/factories');
    const { getWorkspace } = await import('@/store/workspaces');

    const ws = getWorkspace('ws1');
    if (ws) {
      const childDefaults = createTestSession({ workspaceId: 'ws1', parentId: sessionId });
      const { createdAt: _c, updatedAt: _u, ...childInput } = childDefaults;
      const childSession = createSession({ ...childInput, subagentStatus: 'running' });

      // Also register child with interrupt manager so it can be interrupted
      const _childController = interruptManager.registerSession(childSession.id);

      const result = await interruptManager.interruptSession(sessionId);

      // Parent's tools interrupted (none registered), but child should be in cascadedTo
      expect(result.cascadedTo).toContain(childSession.id);

      interruptManager.unregisterSession(childSession.id);
    }

    interruptManager.unregisterSession(sessionId);
  });
});
