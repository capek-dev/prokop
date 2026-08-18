import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from '#tests/factories';
import {
  createPendingAsk,
  listPendingRequestsByRootSession,
  listAllPendingAsks,
  type PendingAskRecord,
} from '@/infrastructure/sqlite/pending-asks';

function makeSession(overrides: { id: string; workspaceId: string; title: string; status: 'active' | 'closed'; parentId?: string }) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

// =============================================================================
// Test Suite — Bugfix 07: Root warning missing when child session is selected
//
// Root cause: The root+descendant replay branch in message-router.ts used
// `isChildAsk = ask.sessionId !== msg.sessionId` to decide canonicalization.
// When syncing a CHILD session, its own asks had isChildAsk=false, so they were
// replayed as `sessionId: childId` instead of `sessionId: rootId, _originSessionId: childId`.
// This caused the client store entry to lose root context, making the root's
// warning badge disappear.
//
// Fix: Use `ask.rootSessionId` to determine canonical presentation, not
// the sync session ID comparison. Any ask with rootSessionId !== sessionId
// is canonicalized regardless of which session triggered the sync.
// =============================================================================

describe('root warning when child session selected (bugfix 07)', () => {
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
  // Helper: simulate the canonical rewrite logic from message-router.ts
  // ===========================================================================

  function simulateCanonicalRewrite(ask: PendingAskRecord) {
    const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
    const canonicalSessionId = hasRootContext ? ask.rootSessionId! : ask.sessionId;
    const askPayload = hasRootContext
      ? { ...ask.ask, _originSessionId: ask.sessionId }
      : ask.ask;
    return { canonicalSessionId, askPayload, hasRootContext };
  }

  // ===========================================================================
  // Core scenario: syncing child session with its own pending ask
  // ===========================================================================

  describe('child session sync canonicalizes own asks to root presentation', () => {
    test('child ask is canonicalized to root when syncing child session', () => {
      const childId = 'child-sync-target';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-child-own',
        rootSessionId,
      }));

      // Simulate syncing child session — listPendingRequestsByRootSession(childId)
      // walks child's descendants (none) and queries WHERE session_id IN (childId)
      const activePendingAsks = listPendingRequestsByRootSession(childId);
      expect(activePendingAsks).toHaveLength(1);

      const ask = activePendingAsks[0];
      expect(ask.sessionId).toBe(childId);
      expect(ask.rootSessionId).toBe(rootSessionId);

      // Apply canonical rewrite (this is what the router now does)
      const { canonicalSessionId, askPayload, hasRootContext } = simulateCanonicalRewrite(ask);

      // Must be root-presented
      expect(hasRootContext).toBe(true);
      expect(canonicalSessionId).toBe(rootSessionId);
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(childId);
    });

    test('child ask canonicalization matches live child-session.ts behavior', () => {
      const childId = 'child-live-match';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-live-match',
        rootSessionId,
      }));

      // Sync child session
      const activePendingAsks = listPendingRequestsByRootSession(childId);
      const ask = activePendingAsks[0];
      const { canonicalSessionId, askPayload } = simulateCanonicalRewrite(ask);

      // Verify it matches what child-session.ts does:
      // sessionId: rootSessionId, ask: { ...ask, _originSessionId: childSessionId }
      expect(canonicalSessionId).toBe(rootSessionId);
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(childId);
    });

    test('root session ask is NOT canonicalized (no root context mismatch)', () => {
      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: rootSessionId,
        requestId: req1,
        toolCallId: 'call-root-own',
        rootSessionId,
      }));

      // Sync root session
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      expect(activePendingAsks).toHaveLength(1);

      const ask = activePendingAsks[0];
      const { canonicalSessionId, hasRootContext } = simulateCanonicalRewrite(ask);

      expect(hasRootContext).toBeFalsy();
      expect(canonicalSessionId).toBe(rootSessionId);
    });

    test('syncing root session still canonicalizes child asks in its tree', () => {
      const childId = 'child-in-root-tree';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-child-in-root',
        rootSessionId,
      }));

      // Sync ROOT session — child ask should be found and canonicalized
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      expect(activePendingAsks).toHaveLength(1);

      const ask = activePendingAsks[0];
      const { canonicalSessionId, askPayload, hasRootContext } = simulateCanonicalRewrite(ask);

      expect(hasRootContext).toBe(true);
      expect(canonicalSessionId).toBe(rootSessionId);
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(childId);
    });
  });

  // ===========================================================================
  // Consistency: both replay branches produce same canonical payload
  // ===========================================================================

  describe('both replay branches produce consistent child-ask payload', () => {
    test('child ask payload is identical whether synced from child or root', () => {
      const childId = 'child-consistency';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-consistency',
        rootSessionId,
      }));

      // Branch A: Sync from child session
      const childSyncAsks = listPendingRequestsByRootSession(childId);
      const branchA = simulateCanonicalRewrite(childSyncAsks[0]);

      // Branch B: Sync from root session
      const rootSyncAsks = listPendingRequestsByRootSession(rootSessionId);
      const branchB = simulateCanonicalRewrite(rootSyncAsks[0]);

      // Both must produce identical canonical presentation
      expect(branchA.canonicalSessionId).toBe(branchB.canonicalSessionId);
      expect(branchA.canonicalSessionId).toBe(rootSessionId);
      expect((branchA.askPayload as Record<string, unknown>)._originSessionId).toBe(
        (branchB.askPayload as Record<string, unknown>)._originSessionId,
      );
      expect((branchA.askPayload as Record<string, unknown>)._originSessionId).toBe(childId);
    });

    test('other-sessions replay branch also produces same canonical payload', () => {
      const childId = 'child-other-branch';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      // Create an unrelated root session for the "other sessions" perspective
      const otherRootId = 'other-root-for-sync';
      createSession(makeSession({ id: otherRootId, workspaceId, title: 'Other Root', status: 'active' }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-other-branch',
        rootSessionId,
      }));

      // Simulate syncing otherRootId — the child ask appears in "other sessions" branch
      const activePendingAsks = listPendingRequestsByRootSession(otherRootId);
      const otherPendingAsks = listAllPendingAsks().filter(
        (ask) =>
          ask.status === 'pending' &&
          ask.sessionId !== otherRootId &&
          !activePendingAsks.some((pa) => pa.requestId === ask.requestId),
      );

      expect(otherPendingAsks).toHaveLength(1);
      const otherBranch = simulateCanonicalRewrite(otherPendingAsks[0]);

      // Compare with direct child sync
      const childSyncAsks = listPendingRequestsByRootSession(childId);
      const directBranch = simulateCanonicalRewrite(childSyncAsks[0]);

      expect(otherBranch.canonicalSessionId).toBe(directBranch.canonicalSessionId);
      expect(otherBranch.canonicalSessionId).toBe(rootSessionId);
      expect((otherBranch.askPayload as Record<string, unknown>)._originSessionId).toBe(
        (directBranch.askPayload as Record<string, unknown>)._originSessionId,
      );
    });
  });

  // ===========================================================================
  // Deep hierarchy: grandchild asks also canonicalized
  // ===========================================================================

  describe('grandchild session canonicalization', () => {
    test('grandchild ask is canonicalized to root when syncing grandchild', () => {
      const childId = 'gc-child';
      const grandchildId = 'gc-grandchild';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));
      createSession(makeSession({ id: grandchildId, workspaceId, title: 'Grandchild', status: 'active', parentId: childId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: grandchildId,
        requestId: req1,
        toolCallId: 'call-grandchild',
        rootSessionId,
      }));

      // Sync grandchild
      const activePendingAsks = listPendingRequestsByRootSession(grandchildId);
      expect(activePendingAsks).toHaveLength(1);

      const { canonicalSessionId, askPayload, hasRootContext } = simulateCanonicalRewrite(activePendingAsks[0]);
      expect(hasRootContext).toBe(true);
      expect(canonicalSessionId).toBe(rootSessionId);
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(grandchildId);
    });

    test('grandchild ask is canonicalized to root when syncing root', () => {
      const childId = 'gc-child-2';
      const grandchildId = 'gc-grandchild-2';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));
      createSession(makeSession({ id: grandchildId, workspaceId, title: 'Grandchild', status: 'active', parentId: childId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: grandchildId,
        requestId: req1,
        toolCallId: 'call-grandchild-2',
        rootSessionId,
      }));

      // Sync root
      const activePendingAsks = listPendingRequestsByRootSession(rootSessionId);
      expect(activePendingAsks).toHaveLength(1);

      const { canonicalSessionId, askPayload, hasRootContext } = simulateCanonicalRewrite(activePendingAsks[0]);
      expect(hasRootContext).toBe(true);
      expect(canonicalSessionId).toBe(rootSessionId);
      expect((askPayload as Record<string, unknown>)._originSessionId).toBe(grandchildId);
    });
  });

  // ===========================================================================
  // Regression: the OLD isChildAsk logic would have been wrong
  // ===========================================================================

  describe('regression: old logic would fail for child-session sync', () => {
    test('OLD logic: isChildAsk=false when syncing child → wrong sessionId', () => {
      const childId = 'child-old-logic';
      createSession(makeSession({ id: childId, workspaceId, title: 'Child', status: 'active', parentId: rootSessionId }));

      const req1 = crypto.randomUUID();
      createPendingAsk(createTestPermissionAsk({
        sessionId: childId,
        requestId: req1,
        toolCallId: 'call-old-logic',
        rootSessionId,
      }));

      // Sync child session
      const activePendingAsks = listPendingRequestsByRootSession(childId);
      const ask = activePendingAsks[0];

      // OLD logic: isChildAsk = ask.sessionId !== msg.sessionId
      // msg.sessionId = childId, ask.sessionId = childId → isChildAsk = false
      // This would produce sessionId: childId (non-canonical)
      const oldLogicIsChildAsk = ask.sessionId !== childId;
      expect(oldLogicIsChildAsk).toBe(false); // OLD logic incorrectly says "not child"

      // NEW logic: based on rootSessionId
      const hasRootContext = ask.rootSessionId && ask.rootSessionId !== ask.sessionId;
      expect(hasRootContext).toBe(true); // NEW logic correctly identifies child origin
    });
  });
});
