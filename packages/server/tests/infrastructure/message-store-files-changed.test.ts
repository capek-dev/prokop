import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ToolPart } from '@prokopai/sdk';
import {
  installWorkspaceFilesChangedListener,
  notifyWorkspaceFilesChanged,
} from '@/application/workspaces/files-changed';
import {
  createMessage,
  createPart,
  transitionToolToCompleted,
  transitionToolToError,
  transitionToolToInterrupted,
  updatePart,
} from '@/infrastructure/sqlite/message-store';
import { createTestAssistantMessage, createTestToolPart } from '#tests/factories';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';

let notified: string[] = [];

beforeEach(() => {
  setupTestDatabase();
  notified = [];
  installWorkspaceFilesChangedListener((workspaceId) => notified.push(workspaceId));
});

afterEach(() => {
  installWorkspaceFilesChangedListener(undefined);
  resetTestDatabase();
});

let seedCounter = 0;

function seedRunningToolPart(name: string): { partId: string; workspaceId: string } {
  const { workspaceId, sessionId } = seedWorkspaceWithSession({ id: `ws-files-${seedCounter++}` });
  const message = createMessage(createTestAssistantMessage(sessionId));
  const part = createPart(createTestToolPart(message.id, {
    name,
    state: { status: 'running', input: {}, startedAt: Date.now() },
  }), sessionId) as ToolPart;
  return { partId: part.id, workspaceId };
}

test('mutating tool completion notifies the workspace once', () => {
  const { partId, workspaceId } = seedRunningToolPart('shell');

  const updated = transitionToolToCompleted(partId, { output: 'done' });

  expect(updated?.state.status).toBe('completed');
  expect(notified).toEqual([workspaceId]);
});

test('non-mutating tools never notify', () => {
  const { partId } = seedRunningToolPart('read-file');

  transitionToolToCompleted(partId, { output: 'contents' });

  expect(notified).toEqual([]);
});

test('mutating error and interrupted transitions notify', () => {
  const errorPart = seedRunningToolPart('write-file');
  transitionToolToError(errorPart.partId, 'boom');
  const interruptedPart = seedRunningToolPart('cp');
  transitionToolToInterrupted(interruptedPart.partId, 'user_request');

  expect(notified).toEqual([errorPart.workspaceId, interruptedPart.workspaceId]);
});

test('unknown part ids fail closed without throwing', () => {
  expect(transitionToolToCompleted('missing-part', {})).toBeNull();
  expect(updatePart('missing-part', { state: { status: 'completed' } })).toBeNull();
  expect(notified).toEqual([]);
});

test('capek-style updatePart terminal state notifies once and not again', () => {
  const { partId, workspaceId } = seedRunningToolPart('edit');
  const terminalState = {
    status: 'completed',
    input: {},
    output: 'patched',
    startedAt: Date.now(),
    completedAt: Date.now(),
  };

  updatePart(partId, { state: terminalState });
  expect(notified).toEqual([workspaceId]);

  updatePart(partId, { state: { ...terminalState, output: 'patched again' } });
  expect(notified).toEqual([workspaceId]);
});

test('updatePart without a terminal state does not notify', () => {
  const { partId } = seedRunningToolPart('shell');

  updatePart(partId, { presentation: { summary: 'rm -rf /tmp/x', debugAvailable: false } });
  updatePart(partId, { state: { status: 'running', input: {}, startedAt: Date.now() } });

  expect(notified).toEqual([]);
});

test('a throwing listener does not break persistence', () => {
  installWorkspaceFilesChangedListener(() => {
    throw new Error('delivery is down');
  });
  const { partId } = seedRunningToolPart('shell');

  const updated = transitionToolToCompleted(partId, { output: 'done' });

  expect(updated?.state.status).toBe('completed');
});

test('notifyWorkspaceFilesChanged isolates listener failures', () => {
  installWorkspaceFilesChangedListener(() => {
    throw new Error('boom');
  });
  expect(() => notifyWorkspaceFilesChanged('ws-x')).not.toThrow();
});
