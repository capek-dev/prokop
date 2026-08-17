import { describe, expect, test } from 'bun:test';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { installMemoryToolFallback } from '../src/plugins/memory-domain';
import { installSchedulerToolFallback } from '../src/plugins/scheduler-domain';
import { installSessionSearchToolFallback } from '../src/plugins/session-search-domain';
import { installSkillsToolFallback } from '../src/plugins/skills-domain';
import { installTaskToolFallback } from '../src/plugins/subagent-domain';
import { installWorkflowToolFallback } from '../src/plugins/workflow-domain';
import {
  getContributedDomainToolPayloads,
  getDomainToolFallback,
  resetDomainToolFallbacksForTests,
  withContributedDomainToolPayloads,
} from '../src/runtime/domain-tool-source';

// The retired compat barrel also re-exported the C6 step 2 store-wiring
// seam (reconcileSessionCompactionWithDeps / reconcileAllSessionsCompaction
// WithDeps). That surface is now pinned by the internal execution subpath
// assertions in package-boundary.test.ts.

/** Minimal RuntimeHost-shaped bindings; the fallback installation only
 * touches the host configuration plus the six explicit domain fallbacks. */
function minimalBindings(): RuntimeHost {
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

/** The production installation path: the server bootstrap calls
 * configureRuntimeHost plus the six explicit domain fallback installs, in
 * this order (see packages/server/src/adapters/capek/bindings.ts). */
function installProductionFallbacks(): void {
  configureRuntimeHost(minimalBindings());
  installSessionSearchToolFallback();
  installSchedulerToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}

describe('unscoped fallback inventory lifecycle', () => {
  test('the production installation path idempotently restores the complete inventory after a test-only reset', () => {
    // The production installation path is idempotent and installs the
    // complete unscoped fallback inventory.
    installProductionFallbacks();
    installProductionFallbacks();
    for (const name of FALLBACK_INVENTORY) {
      expect(getDomainToolFallback(name), name).not.toBeNull();
    }

    // The destructive reset is explicitly test-only.
    resetDomainToolFallbacksForTests();
    for (const name of FALLBACK_INVENTORY) {
      expect(getDomainToolFallback(name), name).toBeNull();
    }

    // Re-installing through the production path restores everything.
    installProductionFallbacks();
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
