import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getJean2CompatibilityBindings,
  getRuntimeConfiguration,
  interruptManager as packageInterruptManager,
} from '@capekai/core/compat/jean2';
import {
  configureCapekJean2Compatibility,
  jean2CompatibilityBindings,
  jean2RuntimeConfiguration,
  jean2StorageBundle,
} from '@/capek-adapter';
import { interruptManager as serverInterruptManager } from '@/core/interrupt';
import { sandboxController as packageHostController } from '@/sandbox';
import { sandboxController as serverController } from '@/sandbox/controller';
import { getSession } from '@/store';

const expectedGroupOperations: Record<keyof typeof jean2CompatibilityBindings, string[]> = {
  interaction: [
    'createPendingAsk', 'removePendingAsk', 'removePendingAsksByToolCallId',
    'getPermissionRequestByRequestId',
    'resolvePermissionRequestByRequestId', 'expirePermissionRequest',
    'expireOldPermissionRequests', 'cancelPendingRequestsBySession',
    'listPendingAsksBySession', 'listPendingAsksByRootSession',
    'listPendingRequestsByRootSession', 'matchGrant', 'createGrantFromOptions',
    'getSessionAutoApproveSeverity', 'getPermissionTimeoutMs', 'notifyPermissionRequired',
  ],
  delivery: ['emit'],
  titles: ['isDefaultSessionTitle', 'hasManualSessionTitle', 'generateSessionTitle'],
  workspace: ['createToolWorkspaceHost'],
  sandbox: ['isSandboxActive'],
};

describe('Čapek Jean2 adapter', () => {
  test('supplies every exact binding operation with no shadowed extras', () => {
    for (const [group, expected] of Object.entries(expectedGroupOperations)) {
      expect(Object.keys(jean2CompatibilityBindings[group as keyof typeof jean2CompatibilityBindings]).sort())
        .toEqual([...expected].sort());
    }
  });

  test('configures the exact adapter value and preserves host function identity', () => {
    configureCapekJean2Compatibility();
    const configured = getJean2CompatibilityBindings();

    expect(configured).toBe(jean2CompatibilityBindings);
    expect('store' in configured).toBe(false);
    expect(jean2StorageBundle.conversation.getSession).toBe(getSession);
    expect(getRuntimeConfiguration()).toBe(jean2RuntimeConfiguration);
  });

  test('constructs per-call workspace host facts without path policy callbacks', () => {
    const host = jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
      workspacePath: '/workspace/project',
      additionalPaths: ['/workspace/shared'],
      sessionId: 'session-1',
    });

    expect(host.root).toBe('/workspace/project');
    expect(host.additionalRoots).toEqual(['/workspace/shared']);
    expect(host.allowedRoots).toHaveLength(1);
    expect(host.allowedRoots?.[0]).toContain('upload');
    expect(host.tempDir).toBe(join(tmpdir(), 'jean2', 'session-1'));
    expect(host.getEnvironmentValue).toBeDefined();
    expect(host.addAdditionalRoot).toBeUndefined();
    expect(host.removeAdditionalRoot).toBeUndefined();
  });

  test('preserves interrupt and sandbox controller singleton identity', () => {
    configureCapekJean2Compatibility();

    expect(serverInterruptManager).toBe(packageInterruptManager);
    expect(packageHostController).toBe(serverController);
  });
});
