import { describe, expect, test } from 'bun:test';
import {
  InterruptManager,
  buildSchemaPromptInstruction,
  executeChildSession,
  executeCompaction,
  executeWorkflow,
  handleChat,
  createStreamHandlers,
  createAskApi,
  requestPermission,
  jean2CompatibilityPhase,
  runGoalLoop,
  streamChatWithRetry,
} from '@capekai/core/compat/jean2';
import { setJean2CompatibilityBindings } from '../src/compat/bindings';
import * as jean2Compat from '@capekai/core/compat/jean2';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  resetDomainToolFallbacksForTests,
  withContributedDomainToolPayloads,
} from '../src/runtime/domain-tool-source';

/** Minimal RuntimeHost-shaped bindings; the fallback installation only
 * touches the host configuration plus the six explicit domain fallbacks. */
function minimalBindings() {
  return {
    interaction: {
      createPendingAsk: () => 'pending',
      removePendingAsk: () => {},
      removePendingAsksByToolCallId: () => {},
      getPermissionRequestByRequestId: () => null,
      resolvePermissionRequestByRequestId: () => false,
      expirePermissionRequest: () => false,
      expireOldPermissionRequests: () => 0,
      cancelPendingRequestsBySession: () => 0,
      listPendingAsksBySession: () => [],
      listPendingAsksByRootSession: () => [],
      listPendingRequestsByRootSession: () => [],
      matchGrant: () => ({ matched: false, grant: null }),
      createGrantFromOptions: () => null,
      getSessionAutoApproveSeverity: () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-compat-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

const FALLBACK_INVENTORY = [
  'task',
  'workflow',
  'memory',
  'agent_memory',
  'skill',
  'skill_manage',
  'agent_skill_manage',
  'session_search',
  'scheduler',
] as const;

describe('Jean2 compatibility runtime exports', () => {
  test('loads implemented Phase 9 runtime through the declared package path', () => {
    expect(jean2CompatibilityPhase).toBe(9);
    expect(typeof streamChatWithRetry).toBe('function');
    expect(typeof createStreamHandlers).toBe('function');
    expect(typeof buildSchemaPromptInstruction).toBe('function');
    expect(typeof executeCompaction).toBe('function');
    expect(typeof handleChat).toBe('function');
    expect(typeof executeChildSession).toBe('function');
    expect(typeof runGoalLoop).toBe('function');
    expect(typeof executeWorkflow).toBe('function');
    expect(typeof createAskApi).toBe('function');
    expect(typeof requestPermission).toBe('function');
    expect(new InterruptManager()).toBeInstanceOf(InterruptManager);
  });

  test('the recovery wiring seam is deps-based and the old store signatures stay absent', () => {
    // The pre-slice store module owned the options-only signatures
    // (sessionId, options); the compat barrel never exported them and must
    // not start now. The C6 step 2 wiring seam is the narrow WithDeps pair
    // only, clearly named so it cannot be confused with the old signatures.
    expect('reconcileSessionCompaction' in jean2Compat).toBe(false);
    expect('reconcileAllSessionsCompaction' in jean2Compat).toBe(false);
    expect(typeof jean2Compat.reconcileSessionCompactionWithDeps).toBe('function');
    expect(typeof jean2Compat.reconcileAllSessionsCompactionWithDeps).toBe('function');
  });
});

describe('unscoped fallback inventory lifecycle', () => {
  test('setJean2CompatibilityBindings idempotently restores the complete inventory after a test-only reset', () => {
    const bindings = minimalBindings();

    // The production installation path is idempotent and installs the
    // complete unscoped fallback inventory.
    setJean2CompatibilityBindings(bindings);
    setJean2CompatibilityBindings(bindings);
    for (const name of FALLBACK_INVENTORY) {
      expect(getDomainToolFallback(name), name).not.toBeNull();
    }

    // The destructive reset is explicitly test-only.
    resetDomainToolFallbacksForTests();
    for (const name of FALLBACK_INVENTORY) {
      expect(getDomainToolFallback(name), name).toBeNull();
    }

    // Re-installing through the production path restores everything.
    setJean2CompatibilityBindings(bindings);
    for (const name of FALLBACK_INVENTORY) {
      expect(getDomainToolFallback(name), name).not.toBeNull();
    }

    // An empty composed scope state survives the reset and never resolves
    // to the fallback registry: the three-state contract is unchanged.
    withContributedDomainToolPayloads(new Map(), () => {
      const scoped = getContributedDomainToolPayloads();
      expect(scoped).not.toBeNull();
      expect(scoped?.size).toBe(0);
    });
    expect(getContributedDomainToolPayloads()).toBeNull();
  });
});
