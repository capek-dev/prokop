import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from '#tests/factories';
import {
  createPendingAsk,
  getPermissionRequestById,
  getPermissionRequestByRequestId,
  listPendingRequestsByRootSession,
  listPendingAsksBySession,
  resolvePermissionRequest,
  resolvePermissionRequestByRequestId,
  expirePermissionRequest,
  cancelPendingRequestsBySession,
  expireOldPermissionRequests,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed'; parentId?: string }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

// =============================================================================
// Test Suite D — Permission Request Lifecycle Tests
//
// Tests the DB-backed permission request lifecycle:
// create → pending → resolve/deny/expire/cancel
// =============================================================================

describe('permission request lifecycle', () => {
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
  // Create and Read
  // ===========================================================================

  describe('create and read', () => {
    test('createPendingAsk creates a request with correct fields', () => {
      const input = createTestPermissionAsk();
      const id = createPendingAsk(input);

      const record = getPermissionRequestById(id);
      expect(record).not.toBeNull();
      expect(record!.requestId).toBe(input.requestId);
      expect(record!.sessionId).toBe(sessionId);
      expect(record!.status).toBe('pending');
      expect(record!.isPermission).toBe(true);
      expect(record!.workspaceId).toBe('ws1');
      expect(record!.rootSessionId).toBe(sessionId);
    });

    test('getPermissionRequestByRequestId looks up by requestId', () => {
      const requestId = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId }));

      const record = getPermissionRequestByRequestId(requestId);
      expect(record).not.toBeNull();
      expect(record!.requestId).toBe(requestId);
    });

    test('getPermissionRequestById returns null for unknown id', () => {
      expect(getPermissionRequestById('nonexistent')).toBeNull();
    });

    test('getPermissionRequestByRequestId returns null for unknown requestId', () => {
      expect(getPermissionRequestByRequestId('nonexistent')).toBeNull();
    });

    test('ask_json is parsed correctly', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-json' }));

      const asks = listPendingAsksBySession(sessionId);
      expect(asks).toHaveLength(1);
      expect(asks[0].ask.type).toBe('permission');
    });
  });

  // ===========================================================================
  // Resolve (Approve)
  // ===========================================================================

  describe('resolve — approve', () => {
    test('resolvePermissionRequest updates status to approved', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-resolve' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      const result = resolvePermissionRequest(id, 'approved', {
        type: 'permission',
        grant: 'workspace',
      });

      expect(result).toBe(true);
      const record = getPermissionRequestById(id);
      expect(record!.status).toBe('approved');
      expect(record!.resolvedAt).toBeDefined();
      expect(record!.resolution).toEqual({ type: 'permission', grant: 'workspace' });
    });

    test('resolvePermissionRequestByRequestId works', () => {
      const requestId = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({ requestId, toolCallId: 'call-resolve-rid' }));

      const result = resolvePermissionRequestByRequestId(requestId, 'approved', {
        type: 'permission',
        grant: 'session',
      });

      expect(result).toBe(true);
      const record = getPermissionRequestByRequestId(requestId);
      expect(record!.status).toBe('approved');
    });

    test('resolving already-resolved request returns false', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-double' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      resolvePermissionRequest(id, 'approved');
      const result = resolvePermissionRequest(id, 'approved');
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Resolve (Deny)
  // ===========================================================================

  describe('resolve — deny', () => {
    test('resolvePermissionRequest updates status to denied', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-deny' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      const result = resolvePermissionRequest(id, 'denied');

      expect(result).toBe(true);
      const record = getPermissionRequestById(id);
      expect(record!.status).toBe('denied');
    });
  });

  // ===========================================================================
  // Expire
  // ===========================================================================

  describe('expire', () => {
    test('expirePermissionRequest marks request as expired', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-expire' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      const result = expirePermissionRequest(id);
      expect(result).toBe(true);

      const record = getPermissionRequestById(id);
      expect(record!.status).toBe('expired');
      expect(record!.resolvedAt).toBeDefined();
    });

    test('expirePermissionRequest returns false for already-expired', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-expire2' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      expirePermissionRequest(id);
      const result = expirePermissionRequest(id);
      expect(result).toBe(false);
    });

    test('expireOldPermissionRequests expires old records', () => {
      const oldTime = Date.now() - 600000;
      const recentTime = Date.now();

      createPendingAsk(createTestPermissionAsk({ toolCallId: 'old-req', createdAt: oldTime }));
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'recent-req', createdAt: recentTime }));

      const count = expireOldPermissionRequests(300000);
      expect(count).toBe(1);

      // listPendingAsksBySession returns all records (not filtered by status)
      // So check that the old one was expired
      const remaining = listPendingAsksBySession(sessionId);
      expect(remaining).toHaveLength(2);
      const expired = remaining.find(a => a.toolCallId === 'old-req');
      expect(expired!.status).toBe('expired');
      const stillPending = remaining.find(a => a.toolCallId === 'recent-req');
      expect(stillPending!.status).toBe('pending');
    });
  });

  // ===========================================================================
  // Cancel (Session Interrupt)
  // ===========================================================================

  describe('cancel', () => {
    test('cancelPendingRequestsBySession cancels all pending for session', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-cancel-1' }));
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-cancel-2' }));

      const count = cancelPendingRequestsBySession(sessionId);
      expect(count).toBe(2);

      const asks = listPendingAsksBySession(sessionId);
      for (const ask of asks) {
        expect(ask.status).toBe('cancelled');
      }
    });

    test('cancelPendingRequestsBySession does not affect other sessions', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-cancel-3' }));

      createSession(makeSession({ id: 'other-session', workspaceId: 'ws1', title: 'Other', status: 'active' }));
      createPendingAsk(createTestPermissionAsk({
        sessionId: 'other-session',
        toolCallId: 'call-cancel-4',
      }));

      const count = cancelPendingRequestsBySession(sessionId);
      expect(count).toBe(1);

      const otherAsks = listPendingAsksBySession('other-session');
      expect(otherAsks).toHaveLength(1);
      expect(otherAsks[0].status).toBe('pending');
    });

    test('cancel does not affect already-resolved requests', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'call-resolved-then-cancel' }));
      const asks = listPendingAsksBySession(sessionId);

      resolvePermissionRequest(asks[0].id, 'approved');
      const count = cancelPendingRequestsBySession(sessionId);
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // Reconnect — listPendingRequestsByRootSession
  // ===========================================================================

  describe('reconnect — pending request listing', () => {
    test('listPendingRequestsByRootSession returns only pending requests', () => {
      const requestId1 = crypto.randomUUID();
      const requestId2 = crypto.randomUUID();

      createPendingAsk(createTestPermissionAsk({ requestId: requestId1, toolCallId: 'pending-1' }));

      createPendingAsk(createTestPermissionAsk({ requestId: requestId2, toolCallId: 'resolved-1' }));
      const allAsks = listPendingAsksBySession(sessionId);
      const resolvedAsk = allAsks.find(a => a.requestId === requestId2);
      resolvePermissionRequest(resolvedAsk!.id, 'approved');

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe(requestId1);
    });

    test('listPendingRequestsByRootSession includes child session requests', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'root-pending' }));

      createSession(makeSession({ id: 'child-sess', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: sessionId }));
      createPendingAsk(createTestPermissionAsk({
        sessionId: 'child-sess',
        toolCallId: 'child-pending',
        rootSessionId: sessionId,
      }));

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(2);
    });

    test('listPendingRequestsByRootSession with nested children', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'root-p' }));

      createSession(makeSession({ id: 'child1', workspaceId: 'ws1', title: 'Child1', status: 'active', parentId: sessionId }));
      createPendingAsk(createTestPermissionAsk({ sessionId: 'child1', toolCallId: 'child-p', rootSessionId: sessionId }));

      createSession(makeSession({ id: 'grandchild1', workspaceId: 'ws1', title: 'GC', status: 'active', parentId: 'child1' }));
      createPendingAsk(createTestPermissionAsk({ sessionId: 'grandchild1', toolCallId: 'gc-p', rootSessionId: sessionId }));

      const pending = listPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(3);
    });
  });

  // ===========================================================================
  // Duplicate / Late Response Handling
  // ===========================================================================

  describe('duplicate and late responses', () => {
    test('resolving an already-resolved request is idempotent (returns false)', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'dup-1' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      expect(resolvePermissionRequest(id, 'approved')).toBe(true);
      expect(resolvePermissionRequest(id, 'approved')).toBe(false);
      expect(resolvePermissionRequest(id, 'denied')).toBe(false);
    });

    test('resolving an expired request returns false', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'late-1' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      expirePermissionRequest(id);
      expect(resolvePermissionRequest(id, 'approved')).toBe(false);
    });

    test('resolving a cancelled request returns false', () => {
      createPendingAsk(createTestPermissionAsk({ toolCallId: 'late-2' }));
      const asks = listPendingAsksBySession(sessionId);
      const id = asks[0].id;

      cancelPendingRequestsBySession(sessionId);
      expect(resolvePermissionRequest(id, 'approved')).toBe(false);
    });
  });
});
