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
  cancelPendingRequestsBySession,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed'; parentId?: string }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

// =============================================================================
// Test Suite E — Stale Session Warning After Refresh & Timeout
//
// Validates that the server replay path only returns truly pending requests,
// and that resolved/expired/cancelled requests are never replayed to clients.
// =============================================================================

describe('stale warning replay (bugfix 05)', () => {
  let sessionId: string;

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function createTestPermissionAsk(overrides: Partial<PendingAskRecord> = {}): Omit<PendingAskRecord, 'id'> {
    return {
      sessionId: overrides.sessionId ?? sessionId,
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
      rootSessionId: overrides.rootSessionId ?? sessionId,
      createdAt: overrides.createdAt ?? Date.now(),
    };
  }

  // ===========================================================================
  // Test 1 — Approved request is not replayed
  // ===========================================================================

  describe('approved requests not replayed', () => {
    test('listPendingRequestsByRootSession excludes approved requests', () => {
      const req1 = crypto.randomUUID();
      const req2 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 'call-pending' }));
      createPendingAsk(createTestPermissionAsk({ requestId: req2, toolCallId: 'call-approved' }));

      // Approve the second request
      resolvePermissionRequestByRequestId(req2, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      // Only the pending one should appear in reconnect listing
      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1);
    });

    test('allPendingAsks with status filter excludes approved', () => {
      const req1 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 'call-to-approve' }));

      // Approve it
      resolvePermissionRequestByRequestId(req1, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      // Simulating what message-router does: listAllPendingAsks().filter(status === 'pending')
      const allFiltered = listAllPendingAsks().filter(a => a.status === 'pending');
      expect(allFiltered).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Test 2 — Expired request is not replayed
  // ===========================================================================

  describe('expired requests not replayed', () => {
    test('listPendingRequestsByRootSession excludes expired requests', () => {
      const req1 = crypto.randomUUID();
      const req2 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 'call-pending' }));
      createPendingAsk(createTestPermissionAsk({ requestId: req2, toolCallId: 'call-expired' }));

      // Expire the second request
      const allAsks = listAllPendingAsks();
      const expired = allAsks.find(a => a.requestId === req2);
      expirePermissionRequest(expired!.id);

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1);
    });

    test('expired request is excluded even if recently created (age-based filtering alone would fail)', () => {
      const req = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req, toolCallId: 'recent-expired' }));

      // Expire it immediately (it's very recent, so age-based filtering wouldn't catch it)
      const allAsks = listAllPendingAsks();
      const record = allAsks.find(a => a.requestId === req);
      expirePermissionRequest(record!.id);

      // Status-based filter correctly excludes it
      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(0);

      // Age-based filter would incorrectly include it
      const now = Date.now();
      const ageFiltered = listAllPendingAsks().filter(a => (now - a.createdAt) < 300000);
      expect(ageFiltered).toHaveLength(1); // Would still be present — proving age filter is insufficient
      expect(ageFiltered[0].status).toBe('expired');
    });
  });

  // ===========================================================================
  // Test 3 — Denied request is not replayed
  // ===========================================================================

  describe('denied requests not replayed', () => {
    test('listPendingRequestsByRootSession excludes denied requests', () => {
      const req1 = crypto.randomUUID();
      const req2 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 'call-pending' }));
      createPendingAsk(createTestPermissionAsk({ requestId: req2, toolCallId: 'call-denied' }));

      resolvePermissionRequestByRequestId(req2, 'denied');

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(req1);
    });
  });

  // ===========================================================================
  // Test 4 — Cancelled request is not replayed
  // ===========================================================================

  describe('cancelled requests not replayed', () => {
    test('listPendingRequestsByRootSession excludes cancelled requests', () => {
      const req1 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 'call-cancel' }));

      cancelPendingRequestsBySession(sessionId);

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(0);
    });

    test('cancelled child session requests not replayed', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-root' }));

      createSession(makeSession({ id: 'child1', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: sessionId }));
      createPendingAsk(createTestPermissionAsk({
        sessionId: 'child1',
        toolCallId: 'call-child',
        rootSessionId: sessionId,
      }));

      // Cancel child session requests
      cancelPendingRequestsBySession('child1');

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].toolCallId).toBe('call-root');
    });
  });

  // ===========================================================================
  // Test 5 — Multiple requests with different statuses
  // ===========================================================================

  describe('mixed status requests', () => {
    test('only pending requests survive all filters', () => {
      const reqPending = crypto.randomUUID();
      const reqApproved = crypto.randomUUID();
      const reqDenied = crypto.randomUUID();
      const reqExpired = crypto.randomUUID();
      const reqCancelled = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: reqPending, toolCallId: 'pending' }));
      createPendingAsk(createTestPermissionAsk({ requestId: reqApproved, toolCallId: 'approved' }));
      createPendingAsk(createTestPermissionAsk({ requestId: reqDenied, toolCallId: 'denied' }));
      createPendingAsk(createTestPermissionAsk({ requestId: reqExpired, toolCallId: 'expired' }));
      createPendingAsk(createTestPermissionAsk({ requestId: reqCancelled, toolCallId: 'cancelled' }));

      resolvePermissionRequestByRequestId(reqApproved, 'approved');
      resolvePermissionRequestByRequestId(reqDenied, 'denied');

      const allAsks = listAllPendingAsks();
      const expiredRecord = allAsks.find(a => a.requestId === reqExpired);
      expirePermissionRequest(expiredRecord!.id);

      cancelPendingRequestsBySession(sessionId);

      // listPendingRequestsByRootSession filters by status='pending'
      // The cancelled one won't appear either since cancelPendingRequestsBySession
      // sets all remaining pending to cancelled
      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(0);
    });

    test('pending requests from different sessions correctly partitioned', () => {
      createSession(makeSession({ id: 'other-session', workspaceId: 'ws1', title: 'Other', status: 'active' }));

      const req1 = crypto.randomUUID();
      const req2 = crypto.randomUUID();
      const req3 = crypto.randomUUID();

      // Session 1: one pending, one approved
      createPendingAsk(createTestPermissionAsk({ requestId: req1, toolCallId: 's1-pending' }));
      createPendingAsk(createTestPermissionAsk({ requestId: req2, toolCallId: 's1-approved' }));
      resolvePermissionRequestByRequestId(req2, 'approved');

      // Session 2: one pending
      createPendingAsk(createTestPermissionAsk({
        sessionId: 'other-session',
        requestId: req3,
        toolCallId: 's2-pending',
        rootSessionId: 'other-session',
      }));

      // Reconnect to session 1 — should only get req1
      const session1Pending = listPendingRequestsByRootSession(sessionId);
      expect(session1Pending).toHaveLength(1);
      expect(session1Pending[0].requestId).toBe(req1);

      // Reconnect to session 2 — should only get req3
      const session2Pending = listPendingRequestsByRootSession('other-session');
      expect(session2Pending).toHaveLength(1);
      expect(session2Pending[0].requestId).toBe(req3);

      // Status-filtered global list should return only the two pending
      const globalPending = listAllPendingAsks().filter(a => a.status === 'pending');
      expect(globalPending).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Test 6 — Full reconnect cycle
  // ===========================================================================

  describe('full reconnect cycle', () => {
    test('pending request survives reconnect', () => {
      const req = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId: req, toolCallId: 'survives' }));

      // Simulate reconnect: server replays pending asks
      const replayed = listPendingRequestsByRootSession(sessionId);
      expect(replayed).toHaveLength(1);
      expect(replayed[0].requestId).toBe(req);
    });

    test('approved request does not survive reconnect', () => {
      const req = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId: req, toolCallId: 'no-survive' }));

      // User approves
      resolvePermissionRequestByRequestId(req, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      // Simulate reconnect
      const replayed = listPendingRequestsByRootSession(sessionId);
      expect(replayed).toHaveLength(0);
    });

    test('expired request does not survive reconnect', () => {
      const req = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId: req, toolCallId: 'expired-no-replay' }));

      // Request times out
      const allAsks = listAllPendingAsks();
      const record = allAsks.find(a => a.requestId === req);
      expirePermissionRequest(record!.id);

      // Simulate reconnect
      const replayed = listPendingRequestsByRootSession(sessionId);
      expect(replayed).toHaveLength(0);
    });

    test('second reconnect after resolution stays clean', () => {
      const req = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId: req, toolCallId: 'double-reconnect' }));

      // First reconnect: still pending
      expect(listPendingRequestsByRootSession(sessionId)).toHaveLength(1);

      // User approves
      resolvePermissionRequestByRequestId(req, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      // Second reconnect: gone
      expect(listPendingRequestsByRootSession(sessionId)).toHaveLength(0);

      // Third reconnect: still gone
      expect(listPendingRequestsByRootSession(sessionId)).toHaveLength(0);
    });
  });
});
