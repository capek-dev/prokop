import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace, seedSession } from '#tests/seed';
import { requestPermission, resolvePermission } from '@capekai/core/internal/ask-authority';
import {
  getWorkspaceGrants,
  matchGrant,
  createGrantFromOptions,
} from '@/store/permissions';
import type { PermissionAsk } from '@jean2/sdk';

// =============================================================================
// Session Scope Isolation Tests (Bugfix Spec 02)
//
// Verifies that session-scoped grants are bound to a root session identity
// and do not leak across unrelated sessions in the same workspace.
// =============================================================================

describe('session scope isolation', () => {
  let workspaceId: string;
  let broadcastMessages: unknown[];

  beforeEach(() => {
    setupTestDatabase();
    const ws = seedWorkspace({ id: 'ws-isolation' });
    workspaceId = ws.id;
    broadcastMessages = [];
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function broadcastFn(message: unknown) {
    broadcastMessages.push(message);
  }

  const readEnvAsk: PermissionAsk = {
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
  // Test 1 — Session grant stays within same root session
  //
  // 1. create session A
  // 2. request cat test/.env
  // 3. approve with session
  // 4. repeat in session A
  // 5. assert no permission prompt (auto-approved)
  // ===========================================================================

  describe('test 1: session grant stays within same root session', () => {
    test('second request in same session is auto-approved', async () => {
      const sessionA = seedSession(workspaceId, { id: 'session-a' });

      // First request — approve with session scope
      const promise1 = requestPermission({
        sessionId: sessionA.id,
        rootSessionId: sessionA.id,
        workspaceId,
        toolCallId: 'call-1a',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Verify grant was persisted with session scope
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('session');
      expect(grants[0].boundRootSessionId).toBe(sessionA.id);

      // Second request in same session — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: sessionA.id,
        rootSessionId: sessionA.id,
        workspaceId,
        toolCallId: 'call-1b',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });
  });

  // ===========================================================================
  // Test 2 — Session grant does not leak to another root session
  //
  // 1. create session A
  // 2. request cat test/.env
  // 3. approve with session
  // 4. create unrelated session B
  // 5. request cat test/.env
  // 6. assert permission prompt appears (NOT auto-approved)
  // ===========================================================================

  describe('test 2: session grant does not leak to another root session', () => {
    test('request in different session triggers prompt', async () => {
      const sessionA = seedSession(workspaceId, { id: 'session-a' });
      const sessionB = seedSession(workspaceId, { id: 'session-b' });

      // First request in session A — approve with session scope
      const promise1 = requestPermission({
        sessionId: sessionA.id,
        rootSessionId: sessionA.id,
        workspaceId,
        toolCallId: 'call-2a',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Verify session-scoped grant exists
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('session');

      // Request in session B — should NOT auto-approve
      broadcastMessages = [];
      const promise2 = requestPermission({
        sessionId: sessionB.id,
        rootSessionId: sessionB.id,
        workspaceId,
        toolCallId: 'call-2b',
        toolName: 'shell',
        ask: readEnvAsk,
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

    test('matchGrant with different rootSessionId does not match session grant', () => {
      const sessionA = seedSession(workspaceId, { id: 'session-a' });

      // Create a session-scoped grant bound to session A
      createGrantFromOptions({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: {
          scope: 'session',
          matcher: 'exact',
          patterns: ['/workspace/.env'],
          action: 'read',
          boundRootSessionId: sessionA.id,
          duration: 30 * 60 * 1000,
        },
      });

      // Matching with same root session → match
      expect(matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        rootSessionId: sessionA.id,
      }).matched).toBe(true);

      // Matching with different root session → no match
      expect(matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        rootSessionId: 'session-b',
      }).matched).toBe(false);

      // Matching without any root session → no match (session grant requires binding)
      expect(matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
      }).matched).toBe(false);
    });
  });

  // ===========================================================================
  // Test 3 — Workspace grant still works across sessions
  //
  // 1. create session A
  // 2. request cat test/.env
  // 3. approve with workspace
  // 4. create session B
  // 5. request cat test/.env
  // 6. assert no permission prompt (auto-approved)
  // ===========================================================================

  describe('test 3: workspace grant still works across sessions', () => {
    test('workspace-scoped grant auto-approves in different session', async () => {
      const sessionA = seedSession(workspaceId, { id: 'session-a' });
      const sessionB = seedSession(workspaceId, { id: 'session-b' });

      // First request in session A — approve with workspace scope
      const promise1 = requestPermission({
        sessionId: sessionA.id,
        rootSessionId: sessionA.id,
        workspaceId,
        toolCallId: 'call-3a',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'workspace' });
      await promise1;

      // Verify workspace-scoped grant exists
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('workspace');
      expect(grants[0].boundRootSessionId).toBeNull();

      // Request in session B — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: sessionB.id,
        rootSessionId: sessionB.id,
        workspaceId,
        toolCallId: 'call-3b',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });
  });

  // ===========================================================================
  // Test 4 — Child session inherits session grant when sharing root session
  //
  // 1. create root session A
  // 2. approve cat test/.env with session
  // 3. issue same request from child session under root A
  // 4. assert no prompt (auto-approved)
  // ===========================================================================

  describe('test 4: child session inherits session grant from root', () => {
    test('child session under same root is auto-approved', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const childOfA = seedSession(workspaceId, { id: 'child-of-a', parentId: rootA.id });

      // Approve in root session with session scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-4a',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Request from child session (same root) — should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId: childOfA.id,
        rootSessionId: rootA.id, // child uses same root
        workspaceId,
        toolCallId: 'call-4b',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });

    test('child session under different root is NOT auto-approved', async () => {
      const rootA = seedSession(workspaceId, { id: 'root-a' });
      const rootB = seedSession(workspaceId, { id: 'root-b' });
      const childOfB = seedSession(workspaceId, { id: 'child-of-b', parentId: rootB.id });

      // Approve in root session A with session scope
      const promise1 = requestPermission({
        sessionId: rootA.id,
        rootSessionId: rootA.id,
        workspaceId,
        toolCallId: 'call-4c',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg1 = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg1.requestId, { type: 'permission', grant: 'session' });
      await promise1;

      // Request from child of root B (different root) — should NOT auto-approve
      broadcastMessages = [];
      const promise2 = requestPermission({
        sessionId: childOfB.id,
        rootSessionId: rootB.id,
        workspaceId,
        toolCallId: 'call-4d',
        toolName: 'shell',
        ask: readEnvAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(broadcastMessages).toHaveLength(1);
      const msg2 = broadcastMessages[0] as { type: string; requestId: string };
      expect(msg2.type).toBe('ask.request');

      // Clean up
      resolvePermission(msg2.requestId, { type: 'permission', grant: 'once' });
      await promise2;
    });
  });
});
