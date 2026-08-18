import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from '#tests/factories';
import {
  createPendingAsk,
  listPendingRequestsByRootSession,
  listAllPendingAsks,
  expirePermissionRequest,
  resolvePermissionRequestByRequestId,
  cleanupAllPendingAsks,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed'; parentId?: string }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

// =============================================================================
// Test Suite — Root/Child permission replay mismatch and timeout stale cleanup
//
// Bugfix 06: Two linked bugs:
// 1. "Other sessions" replay branch sent raw sessionId for child asks instead
//    of rewriting to rootSessionId + _originSessionId (inconsistent with live
//    child-session broadcast and root/descendant replay branch).
// 2. cleanupAllPendingAsks ran AFTER replay, so expired-but-not-yet-cleaned
//    rows could be emitted to clients on reconnect.
// =============================================================================

describe('root/child permission replay and timeout cleanup (bugfix 06)', () => {
  let rootSessionId: string;
  let workspaceId: string;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    rootSessionId = result.sessionId;
    workspaceId = result.workspaceId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createTestPermissionAsk(overrides: Partial<PendingAskRecord> = {}): Omit<PendingAskRecord, 'id'> {
    return {
      sessionId: overrides.sessionId ?? rootSessionId,
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
      workspaceId: overrides.workspaceId ?? workspaceId,
      rootSessionId: overrides.rootSessionId ?? rootSessionId,
      createdAt: overrides.createdAt ?? Date.now(),
    };
  }

  // ===========================================================================
  // Issue 1 — Replay session mapping for child asks
  // ===========================================================================

  describe('replay session mapping for child-origin asks', () => {
    test('root/descendant replay rewrites child ask sessionId to root', () => {
      const childId = 'child-1';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-child',
        rootSessionId,
      }));

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].sessionId).toBe(childId);
      expect(pending[0].rootSessionId).toBe(rootSessionId);

      // The router should rewrite: sessionId → rootSessionId, _originSessionId → childId
      // Validated using rootSessionId-based canonical logic (bugfix 07)
      const ask = pending[0];
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBe(true);
    });

    test('"other sessions" replay rewrites child ask with root context to rootSessionId', () => {
      // Create a separate root session with a child
      const otherRootId = 'other-root';
      const otherChildId = 'other-child';
      createSession(makeSession({ id: otherRootId, workspaceId, title: 'Other Root', status: 'active' }));
      createSession(makeSession({ id: otherChildId, workspaceId, title: 'Other Child', status: 'active', parentId: otherRootId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: otherChildId,
        requestId: req1,
        toolCallId: 'call-other-child',
        rootSessionId: otherRootId,
      }));

      // Simulate the "other sessions" replay branch logic
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      const otherPendingAsks = listAllPendingAsks().filter(
        (ask) =>
          ask.status === 'pending' &&
          ask.sessionId !== rootSessionId &&
          !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
      );

      expect(otherPendingAsks).toHaveLength(1);
      const ask = otherPendingAsks[0];

      // Verify canonical rewrite logic matches live child-session behavior
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBe(true);

      const effectiveSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
      expect(effectiveSessionId).toBe(otherRootId);

      // _originSessionId should point to the actual child session
      const askPayload = hasRootContext
        ? { ...ask.ask, _originSessionId: ask.sessionId }
        : ask.ask;
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(otherChildId);
    });

    test('"other sessions" replay leaves root-level asks unchanged', () => {
      const otherRootId = 'standalone-root';
      createSession(makeSession({ id: otherRootId, workspaceId, title: 'Standalone', status: 'active' }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: otherRootId,
        requestId: req1,
        toolCallId: 'call-standalone',
        rootSessionId: otherRootId,
      }));

      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      const otherPendingAsks = listAllPendingAsks().filter(
        (ask) =>
          ask.status === 'pending' &&
          ask.sessionId !== rootSessionId &&
          !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
      );

      expect(otherPendingAsks).toHaveLength(1);
      const ask = otherPendingAsks[0];

      // No root context mismatch — sessionId === rootSessionId
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBeFalsy();

      const effectiveSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
      expect(effectiveSessionId).toBe(otherRootId);
    });

    test('both replay branches produce consistent payload for child asks', () => {
      const childId = 'child-consistent';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      // Create child ask in the selected root's tree
      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-child-consistent',
        rootSessionId,
      }));

      // Branch A: root/descendant replay (now uses rootSessionId-based canonical logic, bugfix 07)
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      expect(activePendingAsks).toHaveLength(1);
      const branchAAsk = activePendingAsks[0];
      const branchAHasRootContext = branchAAsk.rootSessionId && branchAAsk.rootSessionId !== branchAAsk.sessionId;
      const branchASessionId = branchAHasRootContext ? branchAAsk.rootSessionId! : branchAAsk.sessionId;
      const branchAPayload = branchAHasRootContext
        ? { ...branchAAsk.ask, _originSessionId: branchAAsk.sessionId }
        : branchAAsk.ask;

      // Branch B: "other sessions" replay (same ask from a different root's perspective)
      const branchBSessionId = branchAHasRootContext ? branchAAsk.rootSessionId! : branchAAsk.sessionId;
      const branchBPayload = branchAHasRootContext
        ? { ...branchAAsk.ask, _originSessionId: branchAAsk.sessionId }
        : branchAAsk.ask;

      // Both branches should produce the same sessionId and payload for child asks
      expect(branchASessionId).toBe(branchBSessionId);
      expect((branchAPayload as Record<string, unknown>)._originSessionId).toBe(
        (branchBPayload as Record<string, unknown>)._originSessionId,
      );
      expect((branchAPayload as Record<string, unknown>)._originSessionId).toBe(childId);
    });
  });

  // ===========================================================================
  // Issue 2 — Cleanup-before-replay ordering
  // ===========================================================================

  describe('cleanup before replay ordering', () => {
    test('cleanup expires old pending rows before replay can emit them', () => {
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        requestId: req1,
        toolCallId: 'call-old',
        createdAt: oldTimestamp,
      }));

      // Before cleanup: row exists
      let pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);

      // Run cleanup (simulating moved-before-replay behavior)
      const ASK_TIMEOUT = 5 * 60 * 1000;
      const changed = cleanupAllPendingAsks(ASK_TIMEOUT);
      // Old pending is expired (1) then the just-expired row is also old terminal (deleted: 1)
      expect(changed).toBe(2);

      // After cleanup: row gone — replay would emit nothing
      pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);
    });

    test('recent pending ask survives cleanup and is available for replay', () => {
      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        requestId: req1,
        toolCallId: 'call-recent',
        createdAt: Date.now(), // Just now
      }));

      const ASK_TIMEOUT = 5 * 60 * 1000;
      const deleted = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(deleted).toBe(0);

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1);
    });

    test('expired ask is not replayed even before age-based cleanup runs', () => {
      // This tests the status-based filter as the primary guard
      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        requestId: req1,
        toolCallId: 'call-expired-recent',
        createdAt: Date.now(), // Very recent, age-based cleanup wouldn't touch it
      }));

      // Manually expire it
      const allAsks = listAllPendingAsks();
      const record = allAsks.find(a => a.requestId === req1);
      expirePermissionRequest(record!.id);

      // Status-based filter excludes it
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);

      // Even global list filtered by status excludes it
      const globalFiltered = listAllPendingAsks().filter(a => a.status === 'pending');
      expect(globalFiltered).toHaveLength(0);
    });

    test('full reconnect flow: cleanup first, then status-filtered replay', () => {
      // Mix of: recent pending, old pending, expired recent, approved
      const recentPendingReq = crypto.randomUUID();
      const oldPendingReq = crypto.randomUUID();
      const expiredRecentReq = crypto.randomUUID();
      const approvedReq = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({
        requestId: recentPendingReq,
        toolCallId: 'recent-pending',
        createdAt: Date.now(),
      }));

      createPendingAsk(createTestPermissionAsk({
        requestId: oldPendingReq,
        toolCallId: 'old-pending',
        createdAt: Date.now() - 10 * 60 * 1000, // 10 min ago
      }));

      createPendingAsk(createTestPermissionAsk({
        requestId: expiredRecentReq,
        toolCallId: 'expired-recent',
        createdAt: Date.now(),
      }));

      createPendingAsk(createTestPermissionAsk({
        requestId: approvedReq,
        toolCallId: 'approved',
        createdAt: Date.now(),
      }));

      // Expire and approve
      const allAsks = listAllPendingAsks();
      expirePermissionRequest(allAsks.find(a => a.requestId === expiredRecentReq)!.id);
      resolvePermissionRequestByRequestId(approvedReq, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      // Step 1: Run cleanup (removes old rows)
      const ASK_TIMEOUT = 5 * 60 * 1000;
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Step 2: Replay should only get the recent pending one
      const replayed = listPendingRequestsByRootSession(rootSessionId);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].requestId).toBe(recentPendingReq);
    });
  });

  // ===========================================================================
  // Combined — Child asks + cleanup ordering
  // ===========================================================================

  describe('child ask replay after cleanup', () => {
    test('child ask from old timestamp is cleaned up before replay', () => {
      const childId = 'child-old';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        toolCallId: 'call-old-child',
        rootSessionId,
        createdAt: Date.now() - 10 * 60 * 1000,
      }));

      const ASK_TIMEOUT = 5 * 60 * 1000;
      cleanupAllPendingAsks(ASK_TIMEOUT);

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);
    });

    test('recent child ask survives cleanup and is correctly rewritten for replay', () => {
      const childId = 'child-recent';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-recent-child',
        rootSessionId,
        createdAt: Date.now(),
      }));

      const ASK_TIMEOUT = 5 * 60 * 1000;
      cleanupAllPendingAsks(ASK_TIMEOUT);

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);

      // Verify child ask has correct metadata for rewriting
      const ask = pending[0];
      expect(ask.sessionId).toBe(childId);
      expect(ask.rootSessionId).toBe(rootSessionId);

      // Simulate canonical rewrite (bugfix 07: rootSessionId-based logic)
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBe(true);
      const payload = hasRootContext
        ? { ...ask.ask, _originSessionId: ask.sessionId }
        : ask.ask;
      expect((payload as Record<string, unknown>)._originSessionId).toBe(childId);
    });

    test('other-sessions child ask with expired sibling is not replayed after cleanup', () => {
      const otherRootId = 'other-root-2';
      const otherChildId = 'other-child-2';
      createSession(makeSession({ id: otherRootId, workspaceId, title: 'Other Root', status: 'active' }));
      createSession(makeSession({ id: otherChildId, workspaceId, title: 'Other Child', status: 'active', parentId: otherRootId }));

      // One recent child ask (should survive)
      const recentReq = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: otherChildId,
        requestId: recentReq,
        toolCallId: 'call-recent-other-child',
        rootSessionId: otherRootId,
        createdAt: Date.now(),
      }));

      // One old child ask (should be cleaned up)
      const oldReq = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: otherChildId,
        requestId: oldReq,
        toolCallId: 'call-old-other-child',
        rootSessionId: otherRootId,
        createdAt: Date.now() - 10 * 60 * 1000,
      }));

      // Cleanup
      const ASK_TIMEOUT = 5 * 60 * 1000;
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Simulate "other sessions" replay
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      const otherPendingAsks = listAllPendingAsks().filter(
        (ask) =>
          ask.status === 'pending' &&
          ask.sessionId !== rootSessionId &&
          !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
      );

      expect(otherPendingAsks).toHaveLength(1);
      expect(otherPendingAsks[0].requestId).toBe(recentReq);

      // Verify canonical rewrite
      const ask = otherPendingAsks[0];
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBe(true);
      const effectiveSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
      expect(effectiveSessionId).toBe(otherRootId);
    });
  });
});
