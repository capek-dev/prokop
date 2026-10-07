import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getRuntimeConfiguration } from '@/infrastructure/providers/configuration/runtime';
import { getRuntimeHost as getProkopCompatibilityBindings } from '@/infrastructure/runtime/host';
import { prokopCompatibilityBindings } from '@/harnesses/prokop/composition/bindings';
import {
  prokopRuntimeConfiguration,
  prokopStorageBundle,
} from '@/harnesses/prokop/host';
import { createRuntime } from '@/bootstrap/create-runtime';

const expectedGroupOperations: Record<keyof typeof prokopCompatibilityBindings, string[]> = {
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
  workspace: ['resolveSessionWorkspace', 'createToolWorkspaceHost'],
  toolPolicy: ['resolveDefinition'],
  sandbox: ['isSandboxActive'],
  layout: ['workspaceMemoryDir', 'workspaceSkillsDir', 'agentSkillsDir', 'toolOutputTempRoot'],
};
describe('Čapek Jean2 adapter', () => {
  test('supplies every exact binding operation with no shadowed extras', () => {
    for (const [group, expected] of Object.entries(expectedGroupOperations)) {
      expect(Object.keys(prokopCompatibilityBindings[group as keyof typeof prokopCompatibilityBindings]).sort())
        .toEqual([...expected].sort());
    }
  });

  test('configures the exact adapter value and preserves host function identity', () => {
    createRuntime();
    const configured = getProkopCompatibilityBindings();

    expect(configured).toBe(prokopCompatibilityBindings);
    expect('store' in configured).toBe(false);
    expect(typeof prokopStorageBundle.conversation.getSession).toBe('function');
    expect(getRuntimeConfiguration()).toBe(prokopRuntimeConfiguration);
  });

  test('constructs per-call workspace host facts without path policy callbacks', () => {
    const host = prokopCompatibilityBindings.workspace.createToolWorkspaceHost({
      workspacePath: '/workspace/project',
      additionalPaths: ['/workspace/shared'],
      sessionId: 'session-1',
    });

    expect(host.root).toBe('/workspace/project');
    expect(host.additionalRoots).toEqual(['/workspace/shared']);
    expect(host.allowedRoots).toHaveLength(1);
    expect(host.allowedRoots?.[0]).toContain('upload');
    expect(host.tempDir).toBe(join(realpathSync(tmpdir()), 'jean2', 'session-1'));
    expect(host.getEnvironmentValue).toBeDefined();
    expect(host.addAdditionalRoot).toBeUndefined();
    expect(host.removeAdditionalRoot).toBeUndefined();
  });
});
