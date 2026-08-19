import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Ask } from '@capekai/tool';
import type { AutoApproveSeverity } from '@capekai/types';
import type { PermissionAsk } from '@capekai/tool';
import {
  buildGrantParams,
  createAskPermissionService,
  getAskPermissionPolicy,
  resetDefaultAskPermissionPolicyForTests,
  type AskPermissionServiceCreateOptions,
} from '../src/permission/policy';
import type { AskPermissionPolicyService } from '../src/permission/contracts';
import type { PermissionRuntimeService } from '../src/permission/contracts';
import {
  createPermissionRuntimeService,
} from '../src/permission/runtime';
import {
  createAskApi,
  getAuthorityForPendingAsk,
  getSessionIdForPendingAsk,
  hasPendingAsk,
  rejectAsk,
  rejectPendingAsksBySession,
  rejectPendingAsksByToolCallId,
  resolveAsk,
} from '../src/permission/ask-user-api';
import {
  getPendingRequestsByRootSession as forwardedGetPending,
  getPendingWaiterCount as forwardedWaiterCount,
  hasPendingWaiter as forwardedHasWaiter,
  rejectPermissionsBySession as forwardedRejectPermissionsBySession,
  requestPermission as forwardedRequestPermission,
  resolvePermission as forwardedResolvePermission,
} from '../src/permission/permission-request-manager';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import type { PendingAskRecord } from '../src/runtime/host';
import {
  enterAgentScope,
} from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope, currentAgentPlugins } from './helpers/composition';
import { createAgentScope } from '../src/kernel/kernel';
import { capekPermissionPolicyKey, capekPermissionRuntimeKey } from '../src/plugins/service-keys';

interface InteractionState {
  records: Map<string, PendingAskRecord>;
  resolutions: Array<{ requestId: string; status: 'approved' | 'denied'; response: unknown }>;
  grants: unknown[];
  notifications: Array<{ requestId: string; rootSessionId: string }>;
  broadcasts: unknown[];
  autoApproveSeverity: AutoApproveSeverity | undefined;
  permissionTimeoutMs: number;
}

function makePermissionAsk(overrides: Partial<PermissionAsk> = {}): PermissionAsk {
  return {
    type: 'permission',
    question: overrides.question ?? 'Allow reading file?',
    resource: overrides.resource ?? 'file',
    action: overrides.action ?? 'read',
    patterns: overrides.patterns ?? ['/workspace/file.txt'],
    intents: overrides.intents ?? [{
      resource: 'file',
      action: 'read',
      targets: [{ target: '/workspace/file.txt', matcher: 'exact' }],
      persistable: true,
      allowedScopes: ['once', 'session', 'workspace'],
    }],
    allowedScopes: overrides.allowedScopes ?? ['once', 'session', 'workspace'],
    ...overrides,
  };
}

function makeHost(state: InteractionState, matchGrant: RuntimeHost['interaction']['matchGrant'] = async () => ({
  matched: false,
  grant: null,
})): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async (record: Omit<PendingAskRecord, 'id'>) => {
        const created = { ...record, id: `row-${state.records.size + 1}` };
        state.records.set(created.requestId, created);
        return created.id;
      },
      removePendingAsk: async (id: string) => {
        const record = [...state.records.values()].find(candidate => candidate.id === id);
        if (record) state.records.delete(record.requestId);
      },
      removePendingAsksByToolCallId: async (toolCallId: string) => {
        for (const [requestId, record] of state.records) {
          if (record.toolCallId === toolCallId) state.records.delete(requestId);
        }
      },
      getPermissionRequestByRequestId: async (requestId: string) => state.records.get(requestId) ?? null,
      resolvePermissionRequestByRequestId: async (
        requestId: string,
        status: 'approved' | 'denied',
        response: unknown,
      ) => {
        const record = state.records.get(requestId);
        if (!record || record.status !== 'pending') return false;
        record.status = status;
        state.resolutions.push({ requestId, status, response });
        return true;
      },
      expirePermissionRequest: async (id: string) => {
        const record = [...state.records.values()].find(candidate => candidate.id === id);
        if (!record || record.status !== 'pending') return false;
        record.status = 'expired';
        return true;
      },
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async (sessionId: string) => {
        let count = 0;
        for (const record of state.records.values()) {
          if (record.sessionId === sessionId && record.status === 'pending') {
            record.status = 'cancelled';
            count += 1;
          }
        }
        return count;
      },
      listPendingAsksBySession: async (sessionId: string) =>
        [...state.records.values()].filter(record => record.sessionId === sessionId),
      listPendingAsksByRootSession: async (rootSessionId: string) =>
        [...state.records.values()].filter(record => record.rootSessionId === rootSessionId),
      listPendingRequestsByRootSession: async (rootSessionId: string) =>
        [...state.records.values()].filter(record =>
          record.status === 'pending' && (record.rootSessionId === rootSessionId || record.sessionId === rootSessionId)),
      matchGrant,
      createGrantFromOptions: async (options: unknown) => {
        state.grants.push(options);
        return null;
      },
      getSessionAutoApproveSeverity: async () => state.autoApproveSeverity,
      getPermissionTimeoutMs: () => state.permissionTimeoutMs,
      notifyPermissionRequired: async (requestId: string, rootSessionId: string) => {
        state.notifications.push({ requestId, rootSessionId });
      },
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
        tempDir: '/tmp/capek-c6-permission-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function state(): InteractionState {
  return {
    records: new Map(),
    resolutions: [],
    grants: [],
    notifications: [],
    broadcasts: [],
    autoApproveSeverity: undefined,
    permissionTimeoutMs: 30 * 60 * 1000,
  };
}

let runtime: InteractionState;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  runtime = state();
  configureRuntimeHost(makeHost(runtime));
});

afterEach(() => {
  resetDefaultAskPermissionPolicyForTests();
});

function makePolicy(
  createOptions: AskPermissionServiceCreateOptions = { id: 'test-policy' },
): AskPermissionPolicyService {
  return createAskPermissionService(createOptions);
}

function makeService(
  createOptions: AskPermissionServiceCreateOptions = { id: 'test-policy' },
): PermissionRuntimeService {
  return createPermissionRuntimeService({
    id: 'test-runtime',
    provider: makePolicy(createOptions),
  });
}

function broadcast(message: unknown): void {
  runtime.broadcasts.push(message);
}

describe('C6 permission policy contract', () => {
  test('pins the exact default timeouts', () => {
    runtime.permissionTimeoutMs = 42_000;
    const service = createAskPermissionService({
      id: 'test',
      options: { askTimeoutMs: 300_000, permissionTimeoutMs: 42_000 },
    });
    expect(service.askTimeoutMs).toBe(300_000);
    expect(service.permissionTimeoutMs).toBe(42_000);

    const live = createAskPermissionService({ id: 'live' });
    expect(live.askTimeoutMs).toBe(5 * 60 * 1000);
    expect(live.permissionTimeoutMs).toBe(42_000);
  });

  test('validates only the exact permission response shape', () => {
    const service = makePolicy();
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'once' })).toBe(true);
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'session' })).toBe(true);
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'workspace' })).toBe(true);
    // deny is an approved-shape outcome but not a valid grant scope; the
    // approval check handles it separately.
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'deny' })).toBe(false);
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'always' })).toBe(false);
    expect(service.isValidPermissionResponse({ type: 'permission', grant: 'forever' })).toBe(false);
    expect(service.isValidPermissionResponse({ type: 'permission' })).toBe(false);
    expect(service.isValidPermissionResponse({ type: 'text', value: 'yes' })).toBe(false);
    expect(service.isValidPermissionResponse(undefined)).toBe(false);
    expect(service.isValidPermissionResponse('yes')).toBe(false);

    expect(service.isPermissionApproved({ type: 'permission', grant: 'once' })).toBe(true);
    expect(service.isPermissionApproved({ type: 'permission', grant: 'deny' })).toBe(false);
    expect(service.isPermissionApproved({ type: 'permission', grant: 'always' })).toBe(false);
  });

  test('orders risks and bounds server auto-approval by session severity', async () => {
    const service = makePolicy();
    expect(service.isRiskAtOrBelow('low', 'medium')).toBe(true);
    expect(service.isRiskAtOrBelow('medium', 'medium')).toBe(true);
    expect(service.isRiskAtOrBelow('high', 'medium')).toBe(false);

    const ask = makePermissionAsk({ risk: 'low' });
    const high = makePermissionAsk({ risk: 'high' });

    runtime.autoApproveSeverity = 'off';
    expect(await service.shouldAutoApprove('session', ask)).toBe(false);
    runtime.autoApproveSeverity = undefined;
    expect(await service.shouldAutoApprove('session', ask)).toBe(false);
    runtime.autoApproveSeverity = 'medium';
    expect(await service.shouldAutoApprove('session', ask)).toBe(true);
    expect(await service.shouldAutoApprove('session', high)).toBe(false);
    // No risk on the ask never auto-approves.
    expect(await service.shouldAutoApprove('session', makePermissionAsk())).toBe(false);
    // Non-permission asks never auto-approve.
    expect(await service.shouldAutoApprove('session', { type: 'text', question: 'Q?', target: 'human' } as Ask)).toBe(false);
  });

  test('derives permission keys with the exact precedence', () => {
    const service = makePolicy();
    expect(service.buildPermissionKey('shell', undefined, undefined)).toBe('shell');
    expect(service.buildPermissionKey('shell', 'scheduler', undefined)).toBe('scheduler');
    expect(service.buildPermissionKey('shell', 'file', ['/workspace/.env'])).toBe('/workspace/.env');
  });

  test('detects dangerous shell identities', () => {
    const service = makePolicy();
    expect(service.isDangerousShellIdentity('rm')).toBe(true);
    expect(service.isDangerousShellIdentity('rm -rf')).toBe(true);
    expect(service.isDangerousShellIdentity('mv')).toBe(true);
    expect(service.isDangerousShellIdentity('git reset --hard')).toBe(true);
    expect(service.isDangerousShellIdentity('echo')).toBe(false);
    expect(service.isDangerousShellIdentity(undefined)).toBe(false);
  });

  test('resolves generic ask authority modes', () => {
    const service = makePolicy();
    expect(service.resolveAskAuthority({ type: 'text', question: 'Q?', target: 'human' } as Ask)).toEqual({
      visibilityScope: 'controller_only',
      resolutionMode: 'controller_only',
    });
    expect(service.resolveAskAuthority({
      type: 'client_capability',
      question: 'Pick a tab',
      capability: 'browser_tabs',
      target: 'client',
    } as Ask)).toEqual({
      visibilityScope: 'global',
      resolutionMode: 'first_eligible',
      requiredCapabilities: ['browser_tabs'],
    });
    expect(service.resolveAskAuthority({
      type: 'client_capability',
      question: 'Pick a tab',
      capability: 'browser_tabs',
      target: 'human',
    } as unknown as Ask)).toEqual({
      visibilityScope: 'controller_only',
      resolutionMode: 'controller_only',
    });
  });

  test('builds grant params with the exact scope policy', () => {
    const baseRecord: PendingAskRecord = {
      id: 'row-1',
      requestId: 'req-1',
      sessionId: 'child',
      rootSessionId: 'root',
      workspaceId: 'workspace',
      toolCallId: 'call-1',
      toolName: 'shell',
      ask: makePermissionAsk(),
      status: 'pending',
      isPermission: true,
      createdAt: Date.now(),
    };

    // deny and once never create grants.
    expect(buildGrantParams(baseRecord, { type: 'permission', grant: 'deny' })).toEqual([]);
    expect(buildGrantParams(baseRecord, { type: 'permission', grant: 'once' })).toEqual([]);

    // Workspace approval persists an exact grant for the intent target.
    const workspaceGrants = buildGrantParams(
      baseRecord,
      { type: 'permission', grant: 'workspace' },
    );
    expect(workspaceGrants).toHaveLength(1);
    expect(workspaceGrants[0]).toMatchObject({
      permissionKey: '/workspace/file.txt',
      grantOptions: { scope: 'workspace', matcher: 'exact', patterns: ['/workspace/file.txt'] },
    });

    // Session approval binds to the root session with the 30-minute default.
    const sessionGrants = buildGrantParams(
      baseRecord,
      { type: 'permission', grant: 'session' },
    );
    expect(sessionGrants).toHaveLength(1);
    expect(sessionGrants[0].grantOptions).toMatchObject({
      scope: 'session',
      duration: 30 * 60 * 1000,
      boundRootSessionId: 'root',
    });

    // Out-of-policy workspace approval on a delete ask creates nothing.
    const deleteRecord: PendingAskRecord = {
      ...baseRecord,
      ask: makePermissionAsk({
        resource: 'file',
        action: 'delete',
        patterns: ['/workspace/build/'],
        intents: [{
          resource: 'file',
          action: 'delete',
          targets: [{ target: '/workspace/build/', matcher: 'prefix' }],
          persistable: true,
          allowedScopes: ['once', 'session'],
        }],
        allowedScopes: ['once', 'session'],
      }),
    };
    expect(buildGrantParams(deleteRecord, { type: 'permission', grant: 'workspace' })).toEqual([]);
    const deleteSessionGrants = buildGrantParams(
      deleteRecord,
      { type: 'permission', grant: 'session' },
    );
    expect(deleteSessionGrants).toHaveLength(1);
    expect(deleteSessionGrants[0].grantOptions).toMatchObject({ matcher: 'prefix', action: 'delete' });

    // Dangerous legacy shell grants downgrade to once: the pre-C6 policy
    // still hands a once-scope grant to the store (exact behavior preserved).
    const shellRecord: PendingAskRecord = {
      ...baseRecord,
      ask: makePermissionAsk({
        resource: 'shell-command',
        action: 'execute',
        patterns: ['rm'],
        metadata: { baseCommand: 'rm' },
        intents: [],
      }),
    };
    const shellGrants = buildGrantParams(shellRecord, { type: 'permission', grant: 'workspace' });
    expect(shellGrants).toHaveLength(1);
    expect(shellGrants[0].grantOptions).toMatchObject({ scope: 'once', matcher: 'shell-command' });
  });
});

describe('C6 scoped permission lifecycle', () => {
  test('mixed generic and permission asks sharing one tool call resolve independently', async () => {
    const service = makeService();
    const askApi = service.createAskApi('session', 'shared-call', 'fixture', broadcast);
    const generic = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const permission = askApi(makePermissionAsk()) as Promise<unknown>;
    await flush();
    const permissionId = [...runtime.records.values()].find(record => record.isPermission)!.requestId;

    expect(await service.resolveAsk('shared-call', { type: 'text', value: 'generic' }, 'shared-call#1')).toBe(true);
    expect(await generic).toBe('generic');
    expect(runtime.records.get(permissionId)?.status).toBe('pending');

    expect(await service.resolvePermission(permissionId, { type: 'permission', grant: 'once' })).toBe(true);
    expect(await permission).toBe(true);
  });

  test('request identity routes before toolCallId aliases', async () => {
    const service = makeService();
    const askApi = service.createAskApi('session', 'identity-call', 'fixture', broadcast);
    const generic = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const permission = askApi(makePermissionAsk()) as Promise<unknown>;
    await flush();
    const permissionId = [...runtime.records.values()].find(record => record.isPermission)!.requestId;

    // Resolve the permission through resolveAsk with the permission requestId
    // even though the generic alias for the same toolCallId exists first.
    expect(await service.resolveAsk('identity-call', { type: 'permission', grant: 'once' }, permissionId)).toBe(true);
    expect(await permission).toBe(true);
    expect(runtime.records.get('identity-call#1')?.status).toBe('pending');
    expect(await service.resolveAsk('identity-call', { type: 'text', value: 'done' })).toBe(true);
    expect(await generic).toBe('done');
  });

  test('toolCallId aliases resolve in insertion order', async () => {
    const service = makeService();
    const askApi = service.createAskApi('session', 'alias-call', 'fixture', broadcast);
    const first = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const second = askApi({ type: 'confirm', question: 'Second?', target: 'human' }) as Promise<unknown>;

    await flush();
    expect([...runtime.records.keys()]).toEqual(['alias-call#1', 'alias-call#2']);
    expect(await service.resolveAsk('alias-call', { type: 'text', value: 'alpha' })).toBe(true);
    expect(await first).toBe('alpha');
    expect(await service.resolveAsk('alias-call', { type: 'confirm', confirmed: true })).toBe(true);
    expect(await second).toBe(true);
  });

  test('fails closed for missing, malformed, unknown, and unsupported outcomes with audit preservation', async () => {
    const service = makeService();
    const outcomes: unknown[] = [
      undefined,
      { type: 'text', value: 'yes' },
      { type: 'permission' },
      { type: 'permission', grant: 'always' },
      { type: 'permission', grant: 'forever' },
    ];

    for (const [index, outcome] of outcomes.entries()) {
      const decision = service.requestPermission({
        sessionId: 'session',
        workspaceId: 'workspace',
        toolCallId: `malformed-${index}`,
        toolName: 'fixture',
        ask: makePermissionAsk(),
        broadcastFn: broadcast,
        timeoutMs: 5000,
      });
      await flush();
      const requestId = [...runtime.records.values()].find(
        record => record.toolCallId === `malformed-${index}`,
      )!.requestId;
      expect(await service.resolvePermission(requestId, outcome)).toBe(true);
      expect(await decision).toBe(false);
      expect(runtime.records.get(requestId)?.status).toBe('denied');
    }
    expect(runtime.grants).toHaveLength(0);
    // The raw payload is preserved in the audit resolution record.
    expect(runtime.resolutions.at(-1)?.response).toEqual({ type: 'permission', grant: 'forever' });
  });

  test('records no-waiter decisions for audit and returns false', async () => {
    const service = makeService();
    runtime.records.set('restart-request', {
      id: 'row-restart',
      requestId: 'restart-request',
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'restart-call',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      status: 'pending',
      isPermission: true,
      createdAt: Date.now(),
    });

    expect(await service.resolvePermission('restart-request', { type: 'permission', grant: 'workspace' })).toBe(false);
    expect(runtime.records.get('restart-request')?.status).toBe('approved');
    expect(runtime.resolutions).toHaveLength(1);
    expect(runtime.grants).toHaveLength(0);
  });

  test('bounded auto-approval creates no record and no broadcast', async () => {
    runtime.autoApproveSeverity = 'medium';
    const service = makeService();
    const approved = await service.requestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'auto-call',
      toolName: 'fixture',
      ask: makePermissionAsk({ risk: 'low' }),
      broadcastFn: broadcast,
    });
    expect(approved).toBe(true);
    expect(runtime.records).toHaveLength(0);
    expect(runtime.broadcasts).toHaveLength(0);
  });

  test('reuses matching grants before creating or broadcasting a request', async () => {
    const service = makeService();
    const matchHost = makeHost(runtime, async () => ({ matched: true, grant: null }));
    configureRuntimeHost(matchHost);
    const approved = await service.requestPermission({
      sessionId: 'session',
      rootSessionId: 'root',
      workspaceId: 'workspace',
      toolCallId: 'grant-call',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
    });
    expect(approved).toBe(true);
    expect(runtime.records).toHaveLength(0);
    expect(runtime.broadcasts).toHaveLength(0);
  });

  test('times out, expires the record, and emits cleanup delivery', async () => {
    const service = makeService();
    const promise = service.requestPermission({
      sessionId: 'session',
      rootSessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'timeout-call',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
      timeoutMs: 10,
    });
    await expect(promise).rejects.toThrow('User did not respond in time');
    const record = [...runtime.records.values()][0];
    expect(record.status).toBe('expired');
    expect(runtime.notifications).toHaveLength(1);
    expect(runtime.broadcasts).toContainEqual(expect.objectContaining({ type: 'ask.timeout' }));
  });

  test('reconnects: pending requests survive and resolve by persisted request identity', async () => {
    const service = makeService();
    const promise = service.requestPermission({
      sessionId: 'session',
      rootSessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'reconnect-call',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
      timeoutMs: 5000,
    });

    await flush();
    const pending = await service.getPendingRequestsByRootSession('session');
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
    const requestId = pending[0].requestId;

    expect(await service.resolvePermission(requestId, { type: 'permission', grant: 'workspace' })).toBe(true);
    expect(await promise).toBe(true);
    expect(runtime.grants).toHaveLength(1);
  });

  test('scheduler resource permission asks flow through the same policy', async () => {
    const service = makeService();
    const askApi = service.createAskApi('session', 'scheduler-call', 'scheduler', broadcast, 'workspace');
    const approval = askApi(makePermissionAsk({
      resource: 'scheduler',
      action: 'create',
      patterns: undefined,
      intents: [],
      risk: 'low',
    })) as Promise<unknown>;

    await flush();
    const requestId = [...runtime.records.values()].find(record => record.toolName === 'scheduler')!.requestId;
    expect(await service.resolvePermission(requestId, { type: 'permission', grant: 'deny' })).toBe(true);
    expect(await approval).toBe(false);

    const approval2 = askApi(makePermissionAsk({
      resource: 'scheduler',
      action: 'create',
      patterns: undefined,
      intents: [],
      risk: 'low',
    })) as Promise<unknown>;
    await flush();
    const secondRequestId = [...runtime.records.values()].find(
      record => record.toolName === 'scheduler' && record.status === 'pending',
    )!.requestId;
    expect(await service.resolvePermission(secondRequestId, { type: 'permission', grant: 'session' })).toBe(true);
    expect(await approval2).toBe(true);
    expect(runtime.grants).toHaveLength(1);
    expect(runtime.grants[0]).toMatchObject({
      resource: 'scheduler',
      grantOptions: { scope: 'session', duration: 30 * 60 * 1000 },
    });
  });

  test('rejects and cleans up by tool call and session', async () => {
    const service = makeService();
    const askApi = service.createAskApi('session', 'cleanup-call', 'fixture', broadcast);
    const first = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const second = askApi({ type: 'text', question: 'Second?', target: 'human' }) as Promise<unknown>;
    first.catch(() => {});
    second.catch(() => {});

    expect(await service.rejectPendingAsksByToolCallId('cleanup-call', new Error('ended'))).toHaveLength(2);
    await expect(first).rejects.toThrow('ended');
    await expect(second).rejects.toThrow('ended');
    expect(runtime.records).toHaveLength(0);

    const permission = service.requestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'session-cleanup',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
      timeoutMs: 5000,
    });
    permission.catch(() => {});
    await flush();
    expect((await service.rejectPendingAsksBySession('session', new Error('interrupted'))).length).toBeGreaterThanOrEqual(1);
    await expect(permission).rejects.toThrow('interrupted');
  });
});

describe('C6 scoped permission policy composition', () => {
  test('the permission timeout translates into provider options at composition and freezes', async () => {
    runtime.permissionTimeoutMs = 120_000;
    configureRuntimeHost(makeHost(runtime));
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekPermissionPolicyKey);
      expect(service.id).toBe('current.permission-policy');
      expect(service.permissionTimeoutMs).toBe(120_000);
      expect(service.askTimeoutMs).toBe(5 * 60 * 1000);

      // Reconfiguring the host does not mutate the frozen composed scope.
      const reconfigured = state();
      reconfigured.permissionTimeoutMs = 7_000;
      configureRuntimeHost(makeHost(reconfigured));
      expect(service.permissionTimeoutMs).toBe(120_000);

      const secondScope = await createCurrentAgentScope(processScope);
      try {
        expect(secondScope.require(capekPermissionPolicyKey).permissionTimeoutMs).toBe(7_000);
      } finally {
        await secondScope.dispose();
      }
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the permission policy is an explicit required agent-scoped provider', async () => {
    const processScope = await createCurrentProcessScope();
    const plugins = currentAgentPlugins()
      .filter((plugin) => plugin.id !== 'current.permission-policy');
    const agentScope = await createAgentScope(processScope, [...plugins]);
    try {
      expect(() => enterAgentScope(agentScope, () => undefined))
        .toThrow(/service 'capek\.permission-policy' is not available/);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('enterAgentScope seeds the scope-owned service and two agents stay isolated', async () => {
    const processScope = await createCurrentProcessScope();
    const scopeA = await createCurrentAgentScope(processScope);
    const scopeB = await createCurrentAgentScope(processScope);
    try {
      const policyA = scopeA.require(capekPermissionPolicyKey);
      const policyB = scopeB.require(capekPermissionPolicyKey);
      expect(policyA).not.toBe(policyB);

      const runtimeA: PermissionRuntimeService = scopeA.require(capekPermissionRuntimeKey);
      const runtimeB: PermissionRuntimeService = scopeB.require(capekPermissionRuntimeKey);
      expect(runtimeA).not.toBe(runtimeB);

      let observed: AskPermissionPolicyService | null = null;
      enterAgentScope(scopeA, () => {
        observed = getAskPermissionPolicy();
      });
      expect(observed === policyA).toBe(true);
      expect(getAskPermissionPolicy() === policyA).toBe(false);

      const pendingA = enterAgentScope(scopeA, () =>
        runtimeA.createAskApi('session', 'isolated-call', 'fixture', () => {})(
          { type: 'text', question: 'A?', target: 'human' },
        )) as Promise<unknown>;
      pendingA.catch(() => {});
      expect(runtimeA.hasPendingAsk('isolated-call')).toBe(true);
      expect(runtimeB.hasPendingAsk('isolated-call')).toBe(false);
      await enterAgentScope(scopeA, async () => {
        await runtimeA.rejectPendingAsksBySession('session', new Error('cleanup'));
      });
    } finally {
      await scopeA.dispose();
      await scopeB.dispose();
      await processScope.dispose();
    }
  });

  test('the unscoped process default reads the live permission timeout', () => {
    runtime.permissionTimeoutMs = 99_000;
    configureRuntimeHost(makeHost(runtime));
    expect(getAskPermissionPolicy().permissionTimeoutMs).toBe(99_000);
  });
});

describe('C6 permission API and request manager surfaces', () => {
  test('permission APIs delegate through the scoped service', async () => {
    const askApi = createAskApi('session', 'forwarded-call', 'fixture', broadcast);
    const pending = askApi({ type: 'text', question: 'Forwarded?', target: 'human' }) as Promise<unknown>;

    expect(hasPendingAsk('forwarded-call')).toBe(true);
    expect(await getSessionIdForPendingAsk('forwarded-call')).toBe('session');
    expect(getAuthorityForPendingAsk('forwarded-call')).toEqual({
      visibilityScope: 'controller_only',
      resolutionMode: 'controller_only',
    });
    expect(await resolveAsk('forwarded-call', { type: 'text', value: 'yes' })).toBe(true);
    expect(await pending).toBe('yes');

    const permission = forwardedRequestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'forwarded-permission',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
      timeoutMs: 5000,
    });
    await flush();
    const requestId = [...runtime.records.values()].find(record => record.isPermission)!.requestId;
    expect(forwardedHasWaiter(requestId)).toBe(true);
    expect(forwardedWaiterCount()).toBe(1);
    expect(await forwardedResolvePermission(requestId, { type: 'permission', grant: 'once' })).toBe(true);
    expect(await permission).toBe(true);

    const rejectPending = forwardedRequestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'forwarded-reject',
      toolName: 'fixture',
      ask: makePermissionAsk(),
      broadcastFn: broadcast,
      timeoutMs: 5000,
    });
    rejectPending.catch(() => {});
    await flush();
    expect((await forwardedRejectPermissionsBySession('session', new Error('interrupted'))).length).toBeGreaterThanOrEqual(1);
    await expect(rejectPending).rejects.toThrow('interrupted');

    expect(await forwardedGetPending('session')).toHaveLength(0);
    expect(await rejectAsk('missing-call', new Error('x'))).toBe(false);
    expect(await rejectPendingAsksByToolCallId('missing-call', new Error('x'))).toHaveLength(0);
    expect(await rejectPendingAsksBySession('missing-session', new Error('x'))).toHaveLength(0);
  });
});
