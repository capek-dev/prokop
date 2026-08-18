import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace, seedSession } from '#tests/seed';
import { requestPermission, resolvePermission } from '@capekai/core/internal/ask-authority';
import {
  getWorkspaceGrants,
} from '@/infrastructure/sqlite/permissions';
import type { PermissionAsk } from '@jean2/sdk';

// =============================================================================
// Session Permission Inheritance Tests (Bugfix Spec 03)
//
// Verifies that session-scoped grants approved in the root session are
// inherited by all descendant sessions (children, grandchildren, siblings)
// and do not leak to unrelated root sessions.
// =============================================================================

describe('session permission inheritance across subagents', () => {
  let workspaceId: string;
  let broadcastMessages: unknown[];

  beforeEach(() => {
    setupTestDatabase();
    const ws = seedWorkspace({ id: 'ws-inherit' });
    workspaceId = ws.id;
    broadcastMessages = [];
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function broadcastFn(message: unknown) {
    broadcastMessages.push(message);
  }

  const readFileAsk: PermissionAsk = {
    type: 'permission',
    question: 'Read file ".env". Requires approval.',
    resource: 'file',
    action: 'read',
    patterns: ['/workspace/.env'],
    intents: [{
      resource: 'file',
      action: 'read',
      targets: [{ target: '/workspace/.env', matcher: 'exact' }],
      persistable: true,
      allowedScopes: ['once', 'session', 'workspace'],
    }],
    allowedScopes: ['once', 'session', 'workspace'],
  };

  // ===========================================================================
  // Test 1 — Root session grant reused by child session
  //
  // 1. create root session A
  // 2. request read-file /workspace/.env
  // 3. approve with session
  // 4. create child session A1 under root A
  // 5. request same file in A1
  // 6. assert no prompt
  // ===========================================================================

  describe('test 1: root session grant reused by child session', () => {
    test('child session auto-approves using root session grant', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const childA1 = seedSession(workspaceId, { id: 'child-a1', parentId: rootA.id });

      // Approve in root session with session scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-1a',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Verify grant persisted with session scope bound to root
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('session');
      expect(grants[0].boundRootSessionId).toBe(rootA.id);

      // Request from child session (using rootSessionId = root A) — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: childA1.id,
        rootSessionId: rootA.id, // child uses same root
        workspaceId,
        toolCallId: 'call-1b',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });
  });

  // ===========================================================================
  // Test 2 — Root session grant reused by grandchild session
  //
  // 1. create root session A
  // 2. approve session grant for file X
  // 3. create child session A1
  // 4. create grandchild session A2 under A1
  // 5. request same file in A2
  // 6. assert no prompt
  // ===========================================================================

  describe('test 2: root session grant reused by grandchild session', () => {
    test('grandchild session auto-approves using root session grant', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const childA1 = seedSession(workspaceId, { id: 'child-a1', parentId: rootA.id });
      const grandchildA2 = seedSession(workspaceId, { id: 'grandchild-a2', parentId: childA1.id });

      // Approve in root session with session scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-2a',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Request from grandchild (using rootSessionId = root A) — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: grandchildA2.id,
        rootSessionId: rootA.id, // grandchild uses same root
        workspaceId,
        toolCallId: 'call-2b',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });
  });

  // ===========================================================================
  // Test 3 — Child-created session grant reusable by root and siblings
  //
  // 1. create root session A
  // 2. create child session A1
  // 3. in A1, request file X
  // 4. approve with session
  // 5. in root A, request file X -> no prompt
  // 6. in sibling child A2 under same root, request file X -> no prompt
  // ===========================================================================

  describe('test 3: child-created session grant reusable by root and siblings', () => {
    test('root and sibling can use child-created session grant', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const childA1 = seedSession(workspaceId, { id: 'child-a1', parentId: rootA.id });
      const childA2 = seedSession(workspaceId, { id: 'child-a2', parentId: rootA.id });

      // Approve in child A1 with session scope (bound to root A)
      const promise1 = requestPermission({
        sessionId: childA1.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-3a',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Verify grant is bound to root, not child
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].boundRootSessionId).toBe(rootA.id);

      // Request from root A — should auto-approve
      broadcastMessages = [];
      const resultRoot = await requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-3b',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(resultRoot).toBe(true);
      expect(broadcastMessages).toHaveLength(0);

      // Request from sibling child A2 — should auto-approve
      broadcastMessages = [];
      const resultSibling = await requestPermission({
        sessionId: childA2.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-3c',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(resultSibling).toBe(true);
      expect(broadcastMessages).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Test 4 — Unrelated root session still prompts
  //
  // 1. create root session A
  // 2. approve session grant for file X
  // 3. create root session B
  // 4. request file X in B
  // 5. assert prompt appears
  // ===========================================================================

  describe('test 4: unrelated root session still prompts', () => {
    test('session grant from root A does not auto-approve in root B', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const rootB = seedSession(workspaceId, { id: 'root-b' });

      // Approve in root A with session scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-4a',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Request in root B — should NOT auto-approve
      broadcastMessages = [];
      const promise2 = requestPermission({
        sessionId: rootB.id,
        rootSessionId: rootB.id,
        workspaceId,
        toolCallId: 'call-4b',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      // Should have broadcast (i.e., not auto-approved)
      expect(broadcastMessages).toHaveLength(1);
      const msg2 = broadcastMessages[0] as { type: string; requestId: string };
      expect(msg2.type).toBe('ask.request');

      // Clean up
      resolvePermission(msg2.requestId, { type: 'permission', grant: 'once' });
      await promise2;
    });
  });

  // ===========================================================================
  // Test 5 — Workspace grants still work across all sessions
  //
  // 1. create root session A
  // 2. approve workspace grant for file X
  // 3. request file X in unrelated root session B
  // 4. assert no prompt
  // ===========================================================================

  describe('test 5: workspace grants still work across all sessions', () => {
    test('workspace-scoped grant auto-approves in unrelated session', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const rootB = seedSession(workspaceId, { id: 'root-b' });

      // Approve in root A with workspace scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-5a',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'workspace' });
      await promise1;

      // Verify workspace-scoped grant
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('workspace');
      expect(grants[0].boundRootSessionId).toBeNull();

      // Request in root B — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: rootB.id,
        rootSessionId: rootB.id,
        workspaceId,
        toolCallId: 'call-5b',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0);
    });

    test('workspace grant auto-approves in child of different root', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const rootB = seedSession(workspaceId, { id: 'root-b' });
      const childB1 = seedSession(workspaceId, { id: 'child-b1', parentId: rootB.id });

      // Approve in root A with workspace scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-5c',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'workspace' });
      await promise1;

      // Request from child of root B — should auto-approve (workspace scope)
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: childB1.id,
        rootSessionId: rootB.id,
        workspaceId,
        toolCallId: 'call-5d',
        toolName: 'read-file',
        ask: readFileAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0);
    });
  });
});
