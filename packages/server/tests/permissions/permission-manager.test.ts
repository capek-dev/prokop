import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { requestPermission, resolvePermission, rejectPermission, rejectPermissionsBySession, getPendingRequestsByRootSession, hasPendingWaiter } from '@capekai/core/internal/ask-authority';
import { listPendingAsksBySession } from '@/store/pending-asks';
import {
  getWorkspaceGrants,
  matchGrant,
} from '@/store/permissions';
import type { Ask, PermissionAsk } from '@jean2/sdk';

// =============================================================================
// Test Suite E — Permission Request Manager Integration Tests
// Test Suite F — Mandatory Regression Tests
//
// Tests the full permission request flow through the manager module,
// including auto-approve, grant persistence, scope policy enforcement,
// and the mandatory regression scenarios from the test plan.
// =============================================================================

describe('permission request manager', () => {
  let sessionId: string;
  let workspaceId: string;
  let broadcastMessages: unknown[];

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
    workspaceId = result.workspaceId;
    broadcastMessages = [];
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function broadcastFn(message: unknown) {
    broadcastMessages.push(message);
  }

  function makePermissionAsk(overrides: Partial<PermissionAsk> = {}): PermissionAsk {
    return {
      type: 'permission',
      question: overrides.question ?? 'Allow reading .env?',
      resource: overrides.resource ?? 'file',
      action: overrides.action ?? 'read',
      patterns: overrides.patterns ?? ['/workspace/.env'],
      intents: overrides.intents ?? [{
        resource: 'file',
        action: 'read',
        targets: [{ target: '/workspace/.env', matcher: 'exact' }],
        persistable: true,
        allowedScopes: ['once', 'session', 'workspace'],
      }],
      allowedScopes: overrides.allowedScopes ?? ['once', 'session', 'workspace'],
      ...overrides,
    };
  }

  // ===========================================================================
  // Auto-Approve (Grant Matching)
  // ===========================================================================

  describe('auto-approve', () => {
    test('auto-approves when existing grant matches intent target', async () => {
      // Pre-create a matching grant
      const { createGrantFromOptions } = await import('@/store/permissions');
      createGrantFromOptions({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      const result = await requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-auto',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      // No broadcast since auto-approved
      expect(broadcastMessages).toHaveLength(0);
    });

    test('does not auto-approve when grant does not match target', async () => {
      // Create a grant for a different file
      const { createGrantFromOptions } = await import('@/store/permissions');
      createGrantFromOptions({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/.env',
        grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/.env'], action: 'read' },
      });

      // Ask for a different file
      const ask = makePermissionAsk({
        patterns: ['/workspace/package.json'],
        intents: [{
          resource: 'file',
          action: 'read',
          targets: [{ target: '/workspace/package.json', matcher: 'exact' }],
          persistable: true,
          allowedScopes: ['once', 'session', 'workspace'],
        }],
      });

      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-no-auto',
        toolName: 'shell',
        ask,
        broadcastFn,
        timeoutMs: 5000,
      });

      // Should have broadcast since not auto-approved
      expect(broadcastMessages).toHaveLength(1);
      const msg = broadcastMessages[0] as { type: string; requestId: string };
      expect(msg.type).toBe('ask.request');
      expect(msg.requestId).toBeDefined();

      // Clean up — resolve the pending request
      resolvePermission(msg.requestId, { type: 'permission', grant: 'once' });
      await promise;
    });
  });

  // ===========================================================================
  // Full Request → Response Flow
  // ===========================================================================

  describe('request → response flow', () => {
    test('request creates DB record and broadcasts', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-flow-1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(broadcastMessages).toHaveLength(1);
      const msg = broadcastMessages[0] as { type: string; requestId: string; ask: Ask };
      expect(msg.type).toBe('ask.request');
      expect(msg.requestId).toBeDefined();
      expect(hasPendingWaiter(msg.requestId)).toBe(true);

      // Resolve with workspace approval
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      const result = await promise;
      expect(result).toBe(true);
    });

    test('deny response resolves correctly', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-deny-1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'deny' });
      const result = await promise;
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Grant Persistence on Approval
  // ===========================================================================

  describe('grant persistence', () => {
    test('workspace approval persists file-read grant for exact target', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-persist-1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // Verify grant was persisted
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants.length).toBeGreaterThanOrEqual(1);

      const readGrant = grants.find(g =>
        g.resource === 'file' && g.action === 'read' && g.patterns.includes('/workspace/.env')
      );
      expect(readGrant).toBeDefined();
      expect(readGrant!.scope).toBe('workspace');
      expect(readGrant!.matcher).toBe('exact');
    });

    test('once approval does NOT persist a grant', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-persist-2',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'once' });
      await promise;

      // Once scope should NOT create a persisted grant
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });

    test('session approval persists with expiration', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-persist-3',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].scope).toBe('session');
      expect(grants[0].expiresAt).not.toBeNull();
    });
  });

  // ===========================================================================
  // Scope Policy Enforcement
  // ===========================================================================

  describe('scope policy enforcement', () => {
    test('file delete out-of-policy workspace approval is rejected', async () => {
      const deleteAsk = makePermissionAsk({
        question: 'Delete build directory?',
        resource: 'file',
        action: 'delete',
        patterns: ['/workspace/build/'],
        intents: [{
          resource: 'file',
          action: 'delete',
          targets: [{ target: '/workspace/build/', matcher: 'prefix' }],
          persistable: true,
          allowedScopes: ['once', 'session'], // No workspace allowed for delete
        }],
        allowedScopes: ['once', 'session'],
      });

      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-scope-1',
        toolName: 'shell',
        ask: deleteAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      // User tries to approve with workspace, but it's not in allowedScopes
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // No grant should be persisted — workspace is not in allowedScopes
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });

    test('non-persistable intent always gets once scope', async () => {
      const nonPersistableAsk = makePermissionAsk({
        question: 'Run complex command?',
        resource: 'shell-command',
        action: 'execute',
        patterns: ['cat'],
        intents: [{
          resource: 'shell-command',
          action: 'execute',
          targets: [{ target: 'cat', matcher: 'exact' }],
          persistable: false,
          nonPersistableReason: 'command contains shell operators',
          allowedScopes: ['once'],
        }],
        allowedScopes: ['once'],
      });

      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-scope-2',
        toolName: 'shell',
        ask: nonPersistableAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      // Non-persistable → no grant should be persisted
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Timeout Handling
  // ===========================================================================

  describe('timeout', () => {
    test('request times out after timeoutMs', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-timeout',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 50, // Very short timeout
      });

      await expect(promise).rejects.toThrow('User did not respond in time');
    });
  });

  // ===========================================================================
  // Reject (Error/Interrupt)
  // ===========================================================================

  describe('reject', () => {
    test('rejectPermission rejects the waiter', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-reject-1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      rejectPermission(msg.requestId, new Error('Session interrupted'));

      await expect(promise).rejects.toThrow('Session interrupted');
    });

    test('rejectPermissionsBySession cancels DB records for session', () => {
      // Create two requests (synchronously — don't await the promises)
      requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-reject-sess-1',
        toolName: 'shell',
        ask: makePermissionAsk({ patterns: ['/workspace/file1'] }),
        broadcastFn,
        timeoutMs: 5000,
      }).catch(() => {});

      requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'call-reject-sess-2',
        toolName: 'shell',
        ask: makePermissionAsk({ patterns: ['/workspace/file2'] }),
        broadcastFn,
        timeoutMs: 5000,
      }).catch(() => {});

      // Reject all pending for this session
      const rejectedIds = rejectPermissionsBySession(sessionId, new Error('Session interrupted'));
      expect(rejectedIds.length).toBeGreaterThanOrEqual(1);

      // Verify DB records were cancelled
      const asks = listPendingAsksBySession(sessionId);
      for (const ask of asks) {
        expect(ask.status).toBe('cancelled');
      }
    });
  });

  // ===========================================================================
  // Reconnect
  // ===========================================================================

  describe('reconnect', () => {
    test('getPendingRequestsByRootSession returns pending after request created', async () => {
      requestPermission({
        sessionId,
        rootSessionId: sessionId,
        workspaceId,
        toolCallId: 'call-reconnect-1',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const pending = getPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBeDefined();
      expect(pending[0].status).toBe('pending');
    });

    test('pending request can be resolved after reconnect', async () => {
      const promise = requestPermission({
        sessionId,
        rootSessionId: sessionId,
        workspaceId,
        toolCallId: 'call-reconnect-2',
        toolName: 'shell',
        ask: makePermissionAsk(),
        broadcastFn,
        timeoutMs: 5000,
      });

      const pending = getPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);

      // Resolve using the requestId from the DB
      const requestId = pending[0].requestId;
      resolvePermission(requestId, { type: 'permission', grant: 'workspace' });

      const result = await promise;
      expect(result).toBe(true);
    });
  });
});

// =============================================================================
// Mandatory Regression Tests (Suite F)
//
// These directly test the scenarios from the test plan that were identified
// as critical pain points.
// =============================================================================

describe('mandatory regression tests', () => {
  let sessionId: string;
  let workspaceId: string;
  let broadcastMessages: unknown[];

  beforeEach(() => {
    setupTestDatabase();
    const result = seedWorkspaceWithSession();
    sessionId = result.sessionId;
    workspaceId = result.workspaceId;
    broadcastMessages = [];
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function broadcastFn(message: unknown) {
    broadcastMessages.push(message);
  }

  // ===========================================================================
  // Scenario 1: cat .env
  //
  // Approving "cat .env" with workspace scope must:
  // - Persist a file-read exact grant for .env ONLY
  // - NOT allow "cat package.json" to match
  // - NOT create a generic "cat" permission
  // ===========================================================================

  describe('scenario 1: cat .env', () => {
    const envAsk: PermissionAsk = {
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

    test('workspace approval persists file-read exact for .env', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'cat-env-1',
        toolName: 'shell',
        ask: envAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // Verify persisted grant
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].resource).toBe('file');
      expect(grants[0].action).toBe('read');
      expect(grants[0].matcher).toBe('exact');
      expect(grants[0].patterns).toContain('/workspace/.env');
      expect(grants[0].scope).toBe('workspace');
    });

    test('approved .env grant does NOT match package.json', async () => {
      // First approve .env
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'cat-env-2',
        toolName: 'shell',
        ask: envAsk,
        broadcastFn,
        timeoutMs: 5000,
      });
      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // Now check that package.json is NOT matched
      const matchResult = matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'read',
        permissionKey: '/workspace/package.json',
      });
      expect(matchResult.matched).toBe(false);
    });

    test('approved .env grant DOES auto-approve second .env request', async () => {
      // First approve .env
      const promise1 = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'cat-env-3',
        toolName: 'shell',
        ask: envAsk,
        broadcastFn,
        timeoutMs: 5000,
      });
      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise1;

      // Second request for .env should auto-approve
      broadcastMessages = [];
      const result = await requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'cat-env-4',
        toolName: 'shell',
        ask: envAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      expect(result).toBe(true);
      expect(broadcastMessages).toHaveLength(0); // No broadcast = auto-approved
    });

    test('no generic "cat" permission exists', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'cat-env-5',
        toolName: 'shell',
        ask: envAsk,
        broadcastFn,
        timeoutMs: 5000,
      });
      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // Check no shell-command grant for "cat" exists
      const grants = getWorkspaceGrants(workspaceId);
      const catCommandGrant = grants.find(g =>
        g.resource === 'shell-command' && g.patterns.some(p => p === 'cat')
      );
      expect(catCommandGrant).toBeUndefined();

      // Check no broad file grant exists
      const broadGrant = grants.find(g =>
        g.resource === 'file' && !g.patterns.includes('/workspace/.env')
      );
      expect(broadGrant).toBeUndefined();
    });
  });

  // ===========================================================================
  // Scenario 2: rm -rf build
  //
  // File delete uses session scope (not workspace). Policy must prevent
  // workspace-level persistence for destructive operations.
  // ===========================================================================

  describe('scenario 2: rm -rf build', () => {
    const deleteAsk: PermissionAsk = {
      type: 'permission',
      question: 'Delete "build". Requires approval.',
      resource: 'file',
      action: 'delete',
      patterns: ['/workspace/build/'],
      intents: [{
        resource: 'file',
        action: 'delete',
        targets: [{ target: '/workspace/build/', matcher: 'prefix' }],
        persistable: true,
        allowedScopes: ['once', 'session'], // No workspace allowed for delete
      }],
      allowedScopes: ['once', 'session'],
    };

    test('delete grant uses prefix matcher for recursive rm', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'rm-build-1',
        toolName: 'shell',
        ask: deleteAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].matcher).toBe('prefix');
      expect(grants[0].patterns).toContain('/workspace/build/');
      expect(grants[0].scope).toBe('session');
      expect(grants[0].action).toBe('delete');
    });

    test('delete out-of-policy workspace approval is rejected', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'rm-build-2',
        toolName: 'shell',
        ask: deleteAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      // User tries to give workspace, but it's not in allowedScopes
      resolvePermission(msg.requestId, { type: 'permission', grant: 'workspace' });
      await promise;

      // No grant should be persisted — workspace is not in allowedScopes
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });

    test('delete prefix grant matches nested paths', async () => {
      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'rm-build-3',
        toolName: 'shell',
        ask: deleteAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      // Nested path should match (from same root session)
      expect(matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build/dist/bundle.js',
        rootSessionId: sessionId,
      }).matched).toBe(true);

      // But sibling directory should NOT match
      expect(matchGrant({
        workspaceId,
        toolName: 'shell',
        resource: 'file',
        action: 'delete',
        permissionKey: '/workspace/build-config/',
        rootSessionId: sessionId,
      }).matched).toBe(false);
    });
  });

  // ===========================================================================
  // Scenario 3: Reconnect Reliability
  //
  // Create pending → simulate reconnect → resolve successfully
  // ===========================================================================

  describe('scenario 3: reconnect reliability', () => {
    test('pending request survives and resolves after reconnect', async () => {
      const promise = requestPermission({
        sessionId,
        rootSessionId: sessionId,
        workspaceId,
        toolCallId: 'reconnect-1',
        toolName: 'shell',
        ask: {
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
        },
        broadcastFn,
        timeoutMs: 5000,
      });

      // Simulate: client reconnects and server re-sends pending asks
      const pending = getPendingRequestsByRootSession(sessionId);
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');
      const requestId = pending[0].requestId;

      // Client responds using the requestId
      resolvePermission(requestId, { type: 'permission', grant: 'workspace' });

      const result = await promise;
      expect(result).toBe(true);

      // Verify grant persisted
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(1);
      expect(grants[0].patterns).toContain('/workspace/.env');
    });
  });

  // ===========================================================================
  // Scenario 4: Non-persistable dynamic commands
  //
  // Dynamic commands must not offer unsupported scopes
  // ===========================================================================

  describe('scenario 4: non-persistable dynamic commands', () => {
    test('dynamic rm -rf $TARGET does not persist any grant', async () => {
      const dynamicDeleteAsk: PermissionAsk = {
        type: 'permission',
        question: 'Run dynamic destructive command?',
        resource: 'shell-command',
        action: 'execute',
        patterns: ['rm'],
        intents: [{
          resource: 'shell-command',
          action: 'execute',
          targets: [{ target: 'rm', matcher: 'exact' }],
          persistable: false,
          nonPersistableReason: 'dynamic variable expansion',
          allowedScopes: ['once'],
        }],
        allowedScopes: ['once'],
      };

      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'dynamic-rm-1',
        toolName: 'shell',
        ask: dynamicDeleteAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      // User approves with "session" even though only "once" is allowed
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      // No grant should be persisted (non-persistable → capped to once → not persisted)
      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });

    test('command with operators does not persist grant', async () => {
      const operatorAsk: PermissionAsk = {
        type: 'permission',
        question: 'Run compound command?',
        resource: 'shell-command',
        action: 'execute',
        patterns: ['cat'],
        intents: [{
          resource: 'shell-command',
          action: 'execute',
          targets: [{ target: 'cat', matcher: 'exact' }],
          persistable: false,
          nonPersistableReason: 'command contains shell operators',
          allowedScopes: ['once'],
        }],
        allowedScopes: ['once'],
      };

      const promise = requestPermission({
        sessionId,
        workspaceId,
        toolCallId: 'operator-1',
        toolName: 'shell',
        ask: operatorAsk,
        broadcastFn,
        timeoutMs: 5000,
      });

      const msg = broadcastMessages[0] as { requestId: string };
      resolvePermission(msg.requestId, { type: 'permission', grant: 'session' });
      await promise;

      const grants = getWorkspaceGrants(workspaceId);
      expect(grants).toHaveLength(0);
    });
  });
});
