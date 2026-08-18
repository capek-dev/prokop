import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession, seedSession } from '#tests/seed';
import {
  createPendingAsk,
  listPendingRequestsByRootSession,
  listAllPendingAsks,
  expirePermissionRequest,
  cancelPendingRequestsBySession,
  resolvePermissionRequestByRequestId,
  cleanupAllPendingAsks,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

// =============================================================================
// Test Suite — Bugfix 08: Child timeout prompt lingers in root chat
//
// Validates that:
// 1. Timed-out asks are excluded from the replay data set (status-based filtering)
// 2. Cleanup runs before replay, so orphaned expired rows are deleted
// 3. The batch sync message (ask.pending_sync) correctly represents the
//    authoritative set of truly pending asks for the client
// =============================================================================

describe('child timeout replay sync (bugfix 08)', () => {
  let rootSessionId: string;
  let childSessionId: string;
  const ASK_TIMEOUT = 5 * 60 * 1000;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    rootSessionId = result.sessionId;

    // Create child session under root
    const child = seedSession(result.workspaceId, {
      parentId: rootSessionId,
    });
    childSessionId = child.id;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createPermissionAsk(overrides: Partial<PendingAskRecord> = {}): Omit<PendingAskRecord, 'id'> {
    return {
      sessionId: overrides.sessionId ?? childSessionId,
      rootSessionId: overrides.rootSessionId ?? rootSessionId,
      toolCallId: overrides.toolCallId ?? 'call-1',
      toolName: overrides.toolName ?? 'shell',
      ask: overrides.ask ?? {
        type: 'permission',
        question: 'Allow reading .env?',
        resource: 'file',
        action: 'read',
        intents: [{
          resource: 'file',
          action: 'read',
          targets: [{ target: '/workspace/.env', matcher: 'exact' }],
          persistable: true,
          allowedScopes: ['once', 'session', 'workspace'],
        }],
        allowedScopes: ['once', 'session', 'workspace'],
        patterns: ['/workspace/.env'],
      },
      requestId: overrides.requestId ?? crypto.randomUUID(),
      status: overrides.status ?? 'pending',
      isPermission: overrides.isPermission ?? true,
      workspaceId: overrides.workspaceId ?? 'ws1',
      createdAt: overrides.createdAt ?? Date.now(),
    };
  }

  // ===========================================================================
  // Test 1 — Expired child ask is not in replay data set
  // ===========================================================================

  describe('expired child ask exclusion', () => {
    test('child ask that timed out is excluded from listPendingRequestsByRootSession', () => {
      const req1 = crypto.randomUUID();
      const req2 = crypto.randomUUID();

      // Create a pending ask (still active)
      createPendingAsk(createPermissionAsk({
        requestId: req1,
        toolCallId: 'call-active',
      }));

      // Create another ask and expire it
      const expired = createPendingAsk(createPermissionAsk({
        requestId: req2,
        toolCallId: 'call-expired',
      }));
      expirePermissionRequest(expired);

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(1);
      expect(pending[0].requestId).toBe(req1);
    });

    test('all expired child asks are excluded, only pending included', () => {
      const ids = Array.from({ length: 5 }, () => crypto.randomUUID());

      // Create 3 pending, 2 expired
      for (let i = 0; i < 3; i++) {
        createPendingAsk(createPermissionAsk({
          requestId: ids[i],
          toolCallId: `call-pending-${i}`,
        }));
      }
      for (let i = 3; i < 5; i++) {
        const id = createPendingAsk(createPermissionAsk({
          requestId: ids[i],
          toolCallId: `call-expired-${i}`,
        }));
        expirePermissionRequest(id);
      }

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(3);
      const pendingIds = pending.map((p) => p.requestId).sort();
      expect(pendingIds).toEqual([ids[0], ids[1], ids[2]].sort());
    });
  });

  // ===========================================================================
  // Test 2 — Cleanup before replay removes orphaned rows
  // ===========================================================================

  describe('cleanup before replay', () => {
    test('cleanupAllPendingAsks removes old expired entries before replay', () => {
      const oldTime = Date.now() - ASK_TIMEOUT - 1000;
      const recentTime = Date.now() - 1000;

      // Create an old expired ask
      const oldId = createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        toolCallId: 'call-old',
        createdAt: oldTime,
      }));
      expirePermissionRequest(oldId);

      // Create a recent pending ask
      createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        toolCallId: 'call-recent',
        createdAt: recentTime,
      }));

      // Cleanup removes old entries
      const removed = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(removed).toBe(1);

      // Only the recent one survives
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(1);
      expect(pending[0].toolCallId).toBe('call-recent');
    });

    test('cleanup preserves recent expired entries but they are still excluded from replay', () => {
      const recentTime = Date.now() - 1000;

      // Create a recently-expired ask (within the timeout window)
      const recentExpiredId = createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        toolCallId: 'call-recent-expired',
        createdAt: recentTime,
      }));
      expirePermissionRequest(recentExpiredId);

      // Cleanup does NOT remove it (it's within the age window)
      const removed = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(removed).toBe(0);

      // But it's still excluded from replay by status filter
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(0);
    });
  });

  // ===========================================================================
  // Test 3 — Canonicalization for child asks in replay data set
  // ===========================================================================

  describe('child ask canonicalization', () => {
    test('child ask has rootSessionId set for canonicalization', () => {
      const reqId = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: reqId,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
      }));

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(1);
      expect(pending[0].rootSessionId).toBe(rootSessionId);
      expect(pending[0].sessionId).toBe(childSessionId);
    });

    test('listAllPendingAsks returns child asks with status for other-session replay', () => {
      const reqId = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: reqId,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
      }));

      // Create another root session to query from (different workspace to avoid conflict)
      seedWorkspaceWithSession({ id: 'ws2', name: 'Other Workspace', path: '/other' });

      // listAllPendingAsks includes child asks
      const all = listAllPendingAsks();
      const childAsks = all.filter((a) => a.sessionId === childSessionId);
      expect(childAsks.length).toBe(1);
      expect(childAsks[0].status).toBe('pending');
      expect(childAsks[0].rootSessionId).toBe(rootSessionId);
    });
  });

  // ===========================================================================
  // Test 4 — Batch sync excludes all non-pending statuses
  // ===========================================================================

  describe('batch sync authoritative set', () => {
    test('sync data set excludes approved, denied, expired, and cancelled', () => {
      const reqIds = Array.from({ length: 4 }, () => crypto.randomUUID());

      // Create 4 asks, resolve/expire/cancel 3
      const _id1 = createPendingAsk(createPermissionAsk({
        requestId: reqIds[0],
        toolCallId: 'call-approved',
      }));
      resolvePermissionRequestByRequestId(reqIds[0], 'approved');

      const _id2 = createPendingAsk(createPermissionAsk({
        requestId: reqIds[1],
        toolCallId: 'call-denied',
      }));
      resolvePermissionRequestByRequestId(reqIds[1], 'denied');

      const id3 = createPendingAsk(createPermissionAsk({
        requestId: reqIds[2],
        toolCallId: 'call-expired',
      }));
      expirePermissionRequest(id3);

      const _id4 = createPendingAsk(createPermissionAsk({
        requestId: reqIds[3],
        toolCallId: 'call-cancelled',
        sessionId: childSessionId,
      }));
      cancelPendingRequestsBySession(childSessionId);

      // Create one that stays pending
      const reqPending = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: reqPending,
        toolCallId: 'call-pending',
      }));

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(1);
      expect(pending[0].requestId).toBe(reqPending);
      expect(pending[0].toolCallId).toBe('call-pending');
    });

    test('empty sync set when all asks have been resolved', () => {
      const reqId = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: reqId,
        toolCallId: 'call-1',
      }));
      resolvePermissionRequestByRequestId(reqId, 'approved');

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(0);
    });
  });

  // ===========================================================================
  // Test 5 — Full reconnect cycle with child timeout
  // ===========================================================================

  describe('full reconnect cycle', () => {
    test('child ask timed out before reconnect is excluded from sync', () => {
      // Create child ask
      const childReqId = crypto.randomUUID();
      const childAskId = createPendingAsk(createPermissionAsk({
        requestId: childReqId,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'child-call-1',
      }));

      // Create root ask
      const rootReqId = crypto.randomUUID();
      createPendingAsk({
        sessionId: rootSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'root-call-1',
        toolName: 'shell',
        ask: {
          type: 'permission',
          question: 'Allow reading package.json?',
          resource: 'file',
          action: 'read',
          intents: [{
            resource: 'file',
            action: 'read',
            targets: [{ target: '/workspace/package.json', matcher: 'exact' }],
            persistable: true,
            allowedScopes: ['once', 'session', 'workspace'],
          }],
          allowedScopes: ['once', 'session', 'workspace'],
          patterns: ['/workspace/package.json'],
        },
        requestId: rootReqId,
        status: 'pending',
        isPermission: true,
        workspaceId: 'ws1',
        createdAt: Date.now(),
      });

      // Simulate child ask timeout
      expirePermissionRequest(childAskId);

      // Run cleanup
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Verify sync data set
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(1);
      expect(pending[0].requestId).toBe(rootReqId);
      expect(pending[0].sessionId).toBe(rootSessionId);
    });

    test('multiple sessions with mixed statuses produce correct sync set', () => {
      // Root session has one pending and one expired
      const rootPending = crypto.randomUUID();
      const rootExpired = crypto.randomUUID();
      createPendingAsk({
        sessionId: rootSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'root-pending',
        toolName: 'shell',
        ask: { type: 'permission', question: 'Q1', resource: 'file', action: 'read', intents: [], allowedScopes: ['once'], patterns: [] },
        requestId: rootPending,
        status: 'pending',
        isPermission: true,
        workspaceId: 'ws1',
        createdAt: Date.now(),
      });
      const rootExpiredId = createPendingAsk({
        sessionId: rootSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'root-expired',
        toolName: 'shell',
        ask: { type: 'permission', question: 'Q2', resource: 'file', action: 'read', intents: [], allowedScopes: ['once'], patterns: [] },
        requestId: rootExpired,
        status: 'pending',
        isPermission: true,
        workspaceId: 'ws1',
        createdAt: Date.now(),
      });
      expirePermissionRequest(rootExpiredId);

      // Child session has one pending
      const childPending = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: childPending,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'child-pending',
      }));

      // Verify
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending.length).toBe(2);
      const ids = pending.map((p) => p.requestId).sort();
      expect(ids).toEqual([childPending, rootPending].sort());
    });
  });
});
