import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession, seedSession } from '#tests/seed';
import {
  createPendingAsk,
  listPendingRequestsByRootSession,
  listAllPendingAsks,
  expirePermissionRequest,
  cleanupAllPendingAsks,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

// =============================================================================
// Test Suite — Bugfix 09: Timeout in child session leaves stale warning and
// stale permission prompt in root chat
//
// Root cause: cleanupAllPendingAsks(maxAgeMs) did a raw DELETE by age, which
// bypassed the status lifecycle (pending → expired/approved/denied/cancelled).
// Old pending rows were silently deleted instead of being expired first,
// desynchronizing client state from server state.
//
// Fix: cleanupAllPendingAsks(maxAgeMs) now:
//   1. EXPIRES old pending asks (status transition) before deleting
//   2. DELETES only old terminal asks (approved/denied/expired/cancelled)
//   3. Returns combined changed row count
//
// When maxAgeMs is undefined, full hard-delete behavior is preserved for
// startup/reset paths.
// =============================================================================

describe('cleanup status lifecycle (bugfix 09)', () => {
  let rootSessionId: string;
  let childSessionId: string;
  const ASK_TIMEOUT = 5 * 60 * 1000;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    rootSessionId = result.sessionId;

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
  // Core: cleanup expires old pending instead of deleting
  // ===========================================================================

  describe('status-aware cleanup: old pending → expired → deleted', () => {
    test('old pending ask is expired first, then deleted as terminal', () => {
      const req1 = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: req1,
        toolCallId: 'call-old-pending',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // Before cleanup: row exists and is pending
      let all = listAllPendingAsks();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('pending');

      const changed = cleanupAllPendingAsks(ASK_TIMEOUT);
      // Old pending expired (1) + just-expired row deleted as old terminal (1)
      expect(changed).toBe(2);

      // After cleanup: row is fully removed
      all = listAllPendingAsks();
      expect(all).toHaveLength(0);

      // Replay would emit nothing
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);
    });

    test('old approved ask is deleted directly as terminal', () => {
      const req1 = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: req1,
        toolCallId: 'call-old-approved',
        status: 'approved',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      const changed = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(changed).toBe(1); // 1 terminal deleted

      const all = listAllPendingAsks();
      expect(all).toHaveLength(0);
    });

    test('recent pending ask survives cleanup unchanged', () => {
      const req1 = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: req1,
        toolCallId: 'call-recent-pending',
        createdAt: Date.now(),
      }));

      const changed = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(changed).toBe(0);

      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1);
      expect(pending[0].status).toBe('pending');
    });

    test('recent expired ask survives age-based cleanup but excluded from replay', () => {
      const req1 = crypto.randomUUID();
      const id = createPendingAsk(createPermissionAsk({
        requestId: req1,
        toolCallId: 'call-recent-expired',
        createdAt: Date.now(),
      }));
      expirePermissionRequest(id);

      const changed = cleanupAllPendingAsks(ASK_TIMEOUT);
      expect(changed).toBe(0); // Recent terminal, not old enough to delete

      // Still in DB but excluded from replay by status filter
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);

      // Raw list still has it
      const all = listAllPendingAsks();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe('expired');
    });
  });

  // ===========================================================================
  // Scenario: child session timeout + cleanup + reconnect
  // ===========================================================================

  describe('child session timeout → cleanup → reconnect', () => {
    test('child permission timeout clears from root after cleanup', () => {
      // Child has a pending ask that's about to time out
      const childReq = crypto.randomUUID();
      const childAskId = createPendingAsk(createPermissionAsk({
        requestId: childReq,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'child-call-timeout',
        createdAt: Date.now() - ASK_TIMEOUT - 1000, // Old enough for cleanup
      }));

      // Root also has a recent pending ask
      const rootReq = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: rootReq,
        sessionId: rootSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'root-call-active',
        createdAt: Date.now(), // Recent, survives cleanup
      }));

      // Simulate the timeout marking the child ask as expired
      expirePermissionRequest(childAskId);

      // Now run the cleanup that happens before replay
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Only the root's recent pending ask should be in the replay set
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(rootReq);
      expect(pending[0].sessionId).toBe(rootSessionId);
    });

    test('old child pending ask is expired by cleanup, not silently deleted', () => {
      // Child has an old pending ask (hasn't been explicitly expired yet)
      const childReq = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: childReq,
        sessionId: childSessionId,
        rootSessionId: rootSessionId,
        toolCallId: 'child-call-old',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // Before cleanup: child ask is pending
      let pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');

      // Cleanup expires then deletes it
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // After cleanup: excluded from replay (expired/deleted)
      pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);
    });

    test('mixed ages and statuses: cleanup produces correct authoritative set', () => {
      // Old pending child → expired + deleted
      createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        sessionId: childSessionId,
        rootSessionId,
        toolCallId: 'child-old-pending',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // Recent pending child → survives
      const recentChildReq = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: recentChildReq,
        sessionId: childSessionId,
        rootSessionId,
        toolCallId: 'child-recent-pending',
        createdAt: Date.now(),
      }));

      // Old approved root → deleted
      createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        sessionId: rootSessionId,
        rootSessionId,
        toolCallId: 'root-old-approved',
        status: 'approved',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // Recent expired child → survives cleanup but excluded from replay
      const recentExpiredId = createPendingAsk(createPermissionAsk({
        requestId: crypto.randomUUID(),
        sessionId: childSessionId,
        rootSessionId,
        toolCallId: 'child-recent-expired',
        createdAt: Date.now(),
      }));
      expirePermissionRequest(recentExpiredId);

      // Recent pending root → survives
      const recentRootReq = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: recentRootReq,
        sessionId: rootSessionId,
        rootSessionId,
        toolCallId: 'root-recent-pending',
        createdAt: Date.now(),
      }));

      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Only recent pending asks should be in the replay set
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(2);
      const ids = pending.map((p) => p.requestId).sort();
      expect(ids).toEqual([recentChildReq, recentRootReq].sort());
    });
  });

  // ===========================================================================
  // Hard-delete path (no maxAgeMs) preserved for startup/reset
  // ===========================================================================

  describe('hard-delete path (no maxAgeMs)', () => {
    test('cleanupAllPendingAsks() hard-deletes all rows regardless of status', () => {
      createPendingAsk(createPermissionAsk({
        toolCallId: 'call-pending',
        status: 'pending',
      }));
      createPendingAsk(createPermissionAsk({
        toolCallId: 'call-approved',
        status: 'approved',
      }));
      createPendingAsk(createPermissionAsk({
        toolCallId: 'call-expired',
        status: 'expired',
      }));

      const count = cleanupAllPendingAsks();
      expect(count).toBe(3);
      expect(listAllPendingAsks()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Replay integrity: cleanup before replay prevents stale emission
  // ===========================================================================

  describe('replay integrity after status-aware cleanup', () => {
    test('no stale prompts in root after child timeout + cleanup', () => {
      // Simulate the exact scenario from the bug report:
      // 1. Child session has a permission ask
      const childReq = crypto.randomUUID();
      createPendingAsk(createPermissionAsk({
        requestId: childReq,
        sessionId: childSessionId,
        rootSessionId,
        toolCallId: 'child-timed-out',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // 2. Timeout fires (marks expired)
      const allAsks = listAllPendingAsks();
      const childAsk = allAsks.find((a) => a.requestId === childReq);
      expirePermissionRequest(childAsk!.id);

      // 3. Cleanup runs before replay
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // 4. Replay should emit nothing
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);
    });

    test('reconnect after timeout does not re-emit expired child ask', () => {
      // Create child ask
      const childReq = crypto.randomUUID();
      const childAskId = createPendingAsk(createPermissionAsk({
        requestId: childReq,
        sessionId: childSessionId,
        rootSessionId,
        toolCallId: 'child-reconnect-test',
        createdAt: Date.now() - ASK_TIMEOUT - 1000,
      }));

      // Timeout
      expirePermissionRequest(childAskId);

      // Cleanup
      cleanupAllPendingAsks(ASK_TIMEOUT);

      // Simulate reconnect: replay query
      const pending = listPendingRequestsByRootSession(rootSessionId);
      expect(pending).toHaveLength(0);

      // Second cleanup should also produce nothing
      cleanupAllPendingAsks(ASK_TIMEOUT);
      const pending2 = listPendingRequestsByRootSession(rootSessionId);
      expect(pending2).toHaveLength(0);
    });
  });
});
