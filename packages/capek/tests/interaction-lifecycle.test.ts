import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Ask } from '@capekai/tool';
import type { Session } from '@capekai/types';
import type { PermissionAsk } from '@capekai/tool';
import { configureRuntimeHost, type PendingAskRecord, type RuntimeHost } from '../src/runtime/host';
import {
  createAskApi,
  getAuthorityForPendingAsk,
  getSessionIdForPendingAsk,
  rejectPendingAsksBySession,
  rejectPendingAsksByToolCallId,
  resolveAsk,
} from '../src/permission/ask-user-api';
import {
  rejectPermissionsBySession,
  requestPermission,
  resolvePermission,
} from '../src/permission/permission-request-manager';
import { configureStorage, createInMemoryStorageBundle } from '../src/storage';

interface InteractionState {
  records: Map<string, PendingAskRecord>;
  resolutions: Array<{ requestId: string; status: 'approved' | 'denied'; response: unknown }>;
  grants: unknown[];
  notifications: Array<{ requestId: string; rootSessionId: string }>;
  broadcasts: unknown[];
}

function permissionAsk(overrides: Partial<PermissionAsk> = {}): PermissionAsk {
  return {
    type: 'permission',
    question: 'Allow access?',
    resource: 'file',
    action: 'read',
    patterns: ['/workspace/file.txt'],
    intents: [{
      resource: 'file',
      action: 'read',
      targets: [{ target: '/workspace/file.txt', matcher: 'exact' }],
      persistable: true,
      allowedScopes: ['once', 'session', 'workspace'],
    }],
    allowedScopes: ['once', 'session', 'workspace'],
    ...overrides,
  };
}

function bindInteraction(
  state: InteractionState,
  session?: Session,
  matchGrant: RuntimeHost['interaction']['matchGrant'] = async () => ({
    matched: false,
    grant: null,
  }),
): void {
  const storage = createInMemoryStorageBundle();
  configureStorage({
    ...storage,
    conversation: {
      ...storage.conversation,
      getSession: async () => session ?? null,
    },
  });
  const bindings = {
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
      getSessionAutoApproveSeverity: async () => session?.autoApproveSeverity,
      getPermissionTimeoutMs: () => 5000,
      notifyPermissionRequired: async (requestId: string, rootSessionId: string) => {
        state.notifications.push({ requestId, rootSessionId });
      },
    },
  } as unknown as RuntimeHost;
  configureRuntimeHost(bindings);
}

function state(): InteractionState {
  return {
    records: new Map(),
    resolutions: [],
    grants: [],
    notifications: [],
    broadcasts: [],
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('package-owned generic ask lifecycle', () => {
  let runtime: InteractionState;

  beforeEach(() => {
    runtime = state();
    bindInteraction(runtime);
  });

  afterEach(async () => {
    await rejectPendingAsksBySession('session', new Error('test cleanup'));
  });

  test('extracts values and preserves insertion-order toolCallId aliases', async () => {
    const askApi = createAskApi('session', 'tool-call', 'fixture', message => runtime.broadcasts.push(message));
    const first = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const second = askApi({ type: 'confirm', question: 'Second?', target: 'human' }) as Promise<unknown>;

    await flush();
    expect([...runtime.records.keys()]).toEqual(['tool-call#1', 'tool-call#2']);
    expect(await resolveAsk('tool-call', { type: 'text', value: 'alpha' })).toBe(true);
    expect(await first).toBe('alpha');
    expect(await resolveAsk('tool-call', { type: 'confirm', confirmed: true })).toBe(true);
    expect(await second).toBe(true);
  });

  test('records authority, request identity, and requestId-first routing', async () => {
    const askApi = createAskApi('session', 'capability-call', 'fixture', message => runtime.broadcasts.push(message));
    const pending = askApi({
      type: 'client_capability',
      question: 'Choose a tab',
      capability: 'browser_tabs',
      target: 'client',
    } as Ask);

    expect(getAuthorityForPendingAsk('capability-call')).toEqual({
      visibilityScope: 'global',
      resolutionMode: 'first_eligible',
      requiredCapabilities: ['browser_tabs'],
    });
    expect(await getSessionIdForPendingAsk('capability-call')).toBe('session');
    expect(await resolveAsk('capability-call', { type: 'client_capability', result: 'tab-1' })).toBe(true);
    expect(await pending).toBe('tab-1');

    const permission = requestPermission({
      sessionId: 'session',
      toolCallId: 'permission-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      broadcastFn: message => runtime.broadcasts.push(message),
      timeoutMs: 5000,
    });
    await flush();
    const requestId = [...runtime.records.values()].find(record => record.isPermission)?.requestId;
    expect(requestId).toBeDefined();
    expect(await resolveAsk('wrong-tool-call', { type: 'permission', grant: 'once' }, requestId)).toBe(true);
    expect(await permission).toBe(true);
  });

  test('routes replay responses by generic request identity', async () => {
    const askApi = createAskApi('session', 'replay-call', 'fixture', message => runtime.broadcasts.push(message));
    const pending = askApi({ type: 'text', question: 'Replay?', target: 'human' }) as Promise<unknown>;

    expect(await resolveAsk('replay-call', { type: 'text', value: 'answered' }, 'replay-call#1')).toBe(true);
    expect(await pending).toBe('answered');
    expect(runtime.records).toHaveLength(0);
  });

  test('generic resolution preserves a permission record for the same tool call', async () => {
    const askApi = createAskApi('session', 'shared-call', 'fixture', message => runtime.broadcasts.push(message));
    const generic = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const permission = askApi(permissionAsk()) as Promise<unknown>;
    await flush();
    const permissionId = [...runtime.records.values()].find(record => record.isPermission)!.requestId;

    expect(await resolveAsk('shared-call', { type: 'text', value: 'generic' }, 'shared-call#1')).toBe(true);
    expect(await generic).toBe('generic');
    expect(runtime.records.get(permissionId)?.status).toBe('pending');

    expect(await resolvePermission(permissionId, { type: 'permission', grant: 'once' })).toBe(true);
    expect(await permission).toBe(true);
  });

  test('rejects and cleans up by tool call and session', async () => {
    const askApi = createAskApi('session', 'cleanup-call', 'fixture', message => runtime.broadcasts.push(message));
    const first = askApi({ type: 'text', question: 'First?', target: 'human' }) as Promise<unknown>;
    const second = askApi({ type: 'text', question: 'Second?', target: 'human' }) as Promise<unknown>;
    first.catch(() => {});
    second.catch(() => {});

    expect(await rejectPendingAsksByToolCallId('cleanup-call', new Error('ended'))).toHaveLength(2);
    await expect(first).rejects.toThrow('ended');
    await expect(second).rejects.toThrow('ended');
    expect(runtime.records).toHaveLength(0);

    const sessionAsk = createAskApi('session', 'session-call', 'fixture', () => {})({
      type: 'text',
      question: 'Pending?',
      target: 'human',
    }) as Promise<unknown>;
    sessionAsk.catch(() => {});
    expect(await rejectPendingAsksBySession('session', new Error('interrupted'))).toHaveLength(1);
    await expect(sessionAsk).rejects.toThrow('interrupted');
  });
});

describe('package-owned permission lifecycle and policy', () => {
  let runtime: InteractionState;

  beforeEach(() => {
    runtime = state();
    bindInteraction(runtime);
  });

  afterEach(async () => {
    await rejectPermissionsBySession('session', new Error('test cleanup'));
  });

  test('approves, denies, persists grants, and binds session grants to the root', async () => {
    const approved = requestPermission({
      sessionId: 'child',
      rootSessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'approved-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      broadcastFn: message => runtime.broadcasts.push(message),
      timeoutMs: 5000,
    });
    await flush();
    const approvedId = [...runtime.records.keys()][0];
    resolvePermission(approvedId, { type: 'permission', grant: 'session' });
    expect(await approved).toBe(true);
    await flush();
    expect(runtime.grants).toHaveLength(1);
    expect(runtime.grants[0]).toMatchObject({
      grantOptions: { scope: 'session', boundRootSessionId: 'session' },
    });

    const denied = requestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'denied-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      broadcastFn: message => runtime.broadcasts.push(message),
      timeoutMs: 5000,
    });
    await flush();
    const deniedId = [...runtime.records.keys()].find(id => id !== approvedId)!;
    resolvePermission(deniedId, { type: 'permission', grant: 'deny' });
    expect(await denied).toBe(false);
  });

  test('fails closed for missing, malformed, unknown, and unsupported outcomes', async () => {
    const outcomes: unknown[] = [
      undefined,
      { type: 'text', value: 'yes' },
      { type: 'permission' },
      { type: 'permission', grant: 'always' },
      { type: 'permission', grant: 'forever' },
    ];

    for (const [index, outcome] of outcomes.entries()) {
      const decision = requestPermission({
        sessionId: 'session',
        workspaceId: 'workspace',
        toolCallId: `malformed-${index}`,
        toolName: 'fixture',
        ask: permissionAsk(),
        broadcastFn: message => runtime.broadcasts.push(message),
        timeoutMs: 5000,
      });
      await flush();
      const requestId = [...runtime.records.values()].find(
        record => record.toolCallId === `malformed-${index}`,
      )!.requestId;
      expect(await resolvePermission(requestId, outcome)).toBe(true);
      expect(await decision).toBe(false);
      expect(runtime.records.get(requestId)?.status).toBe('denied');
    }
    expect(runtime.grants).toHaveLength(0);
  });

  test('records no-waiter decisions for audit and returns false', async () => {
    const requestId = 'restart-request';
    runtime.records.set(requestId, {
      id: 'row-restart',
      requestId,
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'restart-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      status: 'pending',
      isPermission: true,
      createdAt: Date.now(),
    });

    expect(await resolvePermission(requestId, { type: 'permission', grant: 'workspace' })).toBe(false);
    expect(runtime.records.get(requestId)?.status).toBe('approved');
    expect(runtime.resolutions).toHaveLength(1);
  });

  test('preserves malformed no-waiter responses in the denied audit record', async () => {
    const requestId = 'malformed-restart-request';
    const response = { type: 'text', value: 'yes' };
    runtime.records.set(requestId, {
      id: 'row-malformed-restart',
      requestId,
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'malformed-restart-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      status: 'pending',
      isPermission: true,
      createdAt: Date.now(),
    });

    expect(await resolvePermission(requestId, response)).toBe(false);
    expect(runtime.records.get(requestId)?.status).toBe('denied');
    expect(runtime.resolutions).toContainEqual({ requestId, status: 'denied', response });
  });

  test('auto-approves only risks within the configured session severity', async () => {
    bindInteraction(runtime, { autoApproveSeverity: 'medium' } as Session);

    const approved = await requestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'auto-approved-call',
      toolName: 'fixture',
      ask: permissionAsk({ risk: 'low' }),
      broadcastFn: message => runtime.broadcasts.push(message),
    });
    expect(approved).toBe(true);
    expect(runtime.records).toHaveLength(0);
    expect(runtime.broadcasts).toHaveLength(0);

    const pending = requestPermission({
      sessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'high-risk-call',
      toolName: 'fixture',
      ask: permissionAsk({ risk: 'high' }),
      broadcastFn: message => runtime.broadcasts.push(message),
      timeoutMs: 5000,
    });
    pending.catch(() => {});
    await flush();
    expect(runtime.records).toHaveLength(1);
    await rejectPermissionsBySession('session', new Error('test cleanup'));
    await expect(pending).rejects.toThrow('test cleanup');
  });

  test('reuses matching grants before creating or broadcasting a request', async () => {
    bindInteraction(runtime, undefined, async () => ({ matched: true, grant: null }));

    const approved = await requestPermission({
      sessionId: 'session',
      rootSessionId: 'root',
      workspaceId: 'workspace',
      toolCallId: 'grant-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      broadcastFn: message => runtime.broadcasts.push(message),
    });

    expect(approved).toBe(true);
    expect(runtime.records).toHaveLength(0);
    expect(runtime.broadcasts).toHaveLength(0);
  });

  test('times out and emits cleanup delivery', async () => {
    const promise = requestPermission({
      sessionId: 'session',
      rootSessionId: 'session',
      workspaceId: 'workspace',
      toolCallId: 'timeout-call',
      toolName: 'fixture',
      ask: permissionAsk(),
      broadcastFn: message => runtime.broadcasts.push(message),
      timeoutMs: 10,
    });

    await expect(promise).rejects.toThrow('User did not respond in time');
    const record = [...runtime.records.values()][0];
    expect(record.status).toBe('expired');
    expect(runtime.notifications).toHaveLength(1);
    expect(runtime.broadcasts).toContainEqual(expect.objectContaining({ type: 'ask.timeout' }));
  });
});
