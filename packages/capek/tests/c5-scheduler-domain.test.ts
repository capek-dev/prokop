/**
 * C5 scheduler domain slice characterization.
 *
 * Pins the composed and unscoped scheduler behavior after the domain move:
 * composed execution uses the scope-captured process host and storage
 * services with one shared availability predicate that also carries the
 * current-session scheduled-job recursion gate; permission risk and ask
 * routing flow
 * through unchanged; host adapter failures keep the current structured
 * error shaping; enabled, disabled, and scheduled-run settings gate the
 * tool identically in composed and explicitly installed unscoped paths;
 * both C5 domains coexist in the current composition with deterministic
 * inventory and tool order; and the session-search domain stays unchanged.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ScheduledJob, Session, Workspace } from '@capekai/types';
import { buildAiSdkTools } from '../src/core/build-tools';
import { createAgentScope } from '../src/kernel/kernel';
import { enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { currentAgentPlugins } from './helpers/composition';
import {
  CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
  SCHEDULER_TOOL_CONTRIBUTION_ID,
  SCHEDULER_TOOL_CONTRIBUTION_ORDER,
  capekSchedulerDomainKey,
  installSchedulerToolFallback,
} from '../src/plugins/scheduler-domain';
import { CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID } from '../src/plugins/session-search-domain';
import { CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID } from '../src/plugins/subagent-domain';
import { CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID } from '../src/plugins/workflow-domain';
import { CURRENT_MEMORY_DOMAIN_PLUGIN_ID } from '../src/plugins/memory-domain';
import { CURRENT_SKILLS_DOMAIN_PLUGIN_ID } from '../src/plugins/skills-domain';
import { resetProviders } from '../src/providers/registry';
import {
  resetDomainToolFallbacksForTests,
  getContributedDomainToolPayloads,
  getDomainToolFallback,
} from '../src/runtime/domain-tool-source';
import { configureRuntimeHost, type PendingAskRecord, type RuntimeHost } from '../src/runtime/host';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost } from '../src/session-search/host';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import type { StorageBundle } from '../src/storage/contracts';
import { configureStorage } from '../src/storage/runtime';
import { resolvePermission } from '../src/permission/permission-request-manager';
import { clearCache } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c5-sched-${label}-`));
  roots.push(path);
  return path;
}

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
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
        tempDir: '/tmp/capek-c5-sched-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

/** Interaction host whose pending records survive long enough for
 * `resolvePermission` to observe and resolve them. */
function permissionAwareHost(): RuntimeHost {
  const base = minimalHost();
  const records = new Map<string, PendingAskRecord>();
  return {
    ...base,
    interaction: {
      ...base.interaction,
      createPendingAsk: async (record) => {
        const id = `pending-${records.size}`;
        records.set(record.requestId, { ...record, id });
        return id;
      },
      getPermissionRequestByRequestId: async (requestId) => records.get(requestId) ?? null,
      resolvePermissionRequestByRequestId: async (requestId, status) => {
        const record = records.get(requestId);
        if (record) record.status = status;
        return Boolean(record);
      },
      expirePermissionRequest: async (requestId) => records.delete(requestId),
    },
  };
}

function scheduledJob(id = 'job-1', workspaceId = 'ws-sched'): ScheduledJob {
  return {
    id,
    workspaceId,
    name: 'Daily task',
    prompt: 'Run the task',
    scheduleKind: 'daily',
    scheduleConfig: { type: 'daily', time: '09:00' },
    scheduleDisplay: 'Daily at 09:00',
    state: 'active',
    repeatLimit: null,
    runCount: 0,
    nextRunAt: null,
    lastRunAt: null,
    lastRunSessionId: null,
    lastError: null,
    reuseSession: false,
    includeHistory: false,
    preconfigId: null,
    originSessionId: null,
    autoApproveSeverity: null,
    notificationsEnabled: false,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

function schedulerHost(overrides: Partial<SchedulerHost> = {}): SchedulerHost {
  const job = scheduledJob();
  return {
    create: () => job,
    get: () => job,
    list: () => [job],
    update: () => job,
    delete: () => true,
    trigger: () => {},
    ...overrides,
  };
}

function schedulerWorkspace(enabled: boolean, risk: 'none' | 'low' = 'none', id = 'ws-sched'): Workspace {
  return {
    id,
    name: 'Scheduler workspace',
    path: '/workspace/scheduler',
    isVirtual: false,
    additionalPaths: [],
    settings: {
      autoApproveSeverity: 'low',
      memory: { enabled: false, permissionRisk: 'low' },
      skills: { managementEnabled: false, permissionRisk: 'low' },
      sessionSearch: { enabled: false, permissionRisk: 'low', includeToolResults: false },
      workflow: { enabled: false },
      scheduling: { enabled, permissionRisk: risk },
    },
    createdAt: '',
    updatedAt: '',
  };
}

/** Storage whose workspace store returns the live fixture object, so tests
 * can mutate settings after build to prove build-time capture. */
function mutableWorkspaceStorage(workspace: Workspace): StorageBundle {
  const base = createInMemoryStorageBundle();
  return {
    ...base,
    workspaces: {
      get: async (id) => (id === workspace.id ? workspace : null),
      getAutoApproveSeverity: async (workspaceId) =>
        workspaceId === workspace.id ? workspace.settings?.autoApproveSeverity ?? 'low' : 'low',
    },
  };
}

function sessionFixture(workspaceId: string, overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-sched',
    workspaceId,
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    ...overrides,
  } as Session;
}

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeHost(minimalHost());
  configureSessionSearchHost();
  configureSchedulerHost(schedulerHost());
  configureWorkspaceToolDiscovery();
}

beforeEach(() => configureEnvironment());

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  resetProviders();
  clearCache();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

function buildOptions(workspacePath: string, workspaceId: string, sessionId = 'sess-sched') {
  return {
    toolNames: [],
    workspacePath,
    workspaceId,
    sessionId,
    canSpawnSubagents: false,
    allowedSkills: null,
    // The ask api is created for every execution (pre-C5 behavior), so a
    // channel must exist even when the configured risk never asks.
    broadcastFn: () => {},
  };
}

async function schedulerWorkspaceDir(label: string): Promise<{ root: string; workspacePath: string }> {
  const root = await tempDir(label);
  const workspacePath = join(root, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  return { root, workspacePath };
}

const createInput = {
  action: 'create',
  name: 'Daily task',
  prompt: 'Run',
  schedule: { type: 'daily', time: '09:00' },
};

describe('C5 scheduler composed execution', () => {
  test('the composed tool delegates create and trigger to the captured host with the exact shaped results', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('delegation');
    const workspace = schedulerWorkspace(true);
    let created = false;
    let triggered = false;
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    configureStorage(storage);
    configureSchedulerHost(schedulerHost({
      create(_workspaceId, input) {
        created = input.originSessionId === 'sess-sched';
        return scheduledJob();
      },
      trigger() {
        triggered = true;
      },
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(Object.keys(tools)).toEqual(['scheduler', 'retrieve-tool-output']);

        const createResult = await tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-create', messages: [] },
        );
        expect(createResult).toEqual({
          action: 'create',
          title: 'Scheduled job "Daily task" created',
          job: scheduledJob(),
          _visualization: {
            type: 'none',
            message: 'Scheduled job "Daily task" created',
          },
        });
        expect(created).toBe(true);

        const triggerResult = await tools['scheduler']!.execute!(
          { action: 'trigger', jobId: 'job-1' },
          { toolCallId: 'call-trigger', messages: [] },
        );
        expect(triggerResult).toEqual({
          action: 'trigger',
          title: 'Job "Daily task" triggered',
          jobId: 'job-1',
          _visualization: {
            type: 'none',
            message: 'Job "Daily task" triggered',
          },
        });
        expect(triggered).toBe(true);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a throwing host adapter keeps the current structured error shaping through the built tool', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('throwing-host');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost(schedulerHost({
      create() {
        throw new Error('Scheduler host is not configured');
      },
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        const result = await tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-throw', messages: [] },
        );
        expect(result).toEqual({ error: 'Scheduler host is not configured' });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('list stays read-only and keeps its current title shape through the composed tool', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('list');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost(schedulerHost());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        const result = await tools['scheduler']!.execute!(
          { action: 'list' },
          { toolCallId: 'call-list', messages: [] },
        );
        expect(result).toEqual({
          action: 'list',
          title: '1 scheduled job',
          jobs: [scheduledJob()],
          _visualization: {
            type: 'none',
            badge: '1 job',
            message: '1 scheduled job',
          },
        });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('permission risk routes through the ask seam with denial and approval unchanged', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('permission');
    const workspace = schedulerWorkspace(true, 'low');
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureRuntimeHost(permissionAwareHost());
    configureSchedulerHost(schedulerHost());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        let pendingRequestId: string | null = null;
        const tools = await buildAiSdkTools({
          ...buildOptions(workspacePath, workspace.id),
          broadcastFn: (message) => {
            if (message.type === 'ask.request' && 'requestId' in message) {
              pendingRequestId = message.requestId ?? null;
            }
          },
        });

        const deniedPromise = tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-denied', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'deny' });
        expect(await deniedPromise).toEqual({ error: 'USER_REJECTION' });

        pendingRequestId = null;
        const approvedPromise = tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-approved', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'once' });
        expect(await approvedPromise).toEqual({
          action: 'create',
          title: 'Scheduled job "Daily task" created',
          job: scheduledJob(),
          _visualization: {
            type: 'none',
            message: 'Scheduled job "Daily task" created',
          },
        });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('cross-workspace job mutations stay denied through the composed tool', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('cross-workspace');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    let deleted = false;
    const foreign = scheduledJob('foreign-job', 'other-workspace');
    configureSchedulerHost(schedulerHost({
      get: () => foreign,
      delete() {
        deleted = true;
        return true;
      },
    }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        const result = await tools['scheduler']!.execute!(
          { action: 'remove', jobId: foreign.id },
          { toolCallId: 'call-foreign', messages: [] },
        );
        expect(result).toEqual({ error: 'Job does not belong to this workspace' });
        expect(deleted).toBe(false);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed payload uses the scope-captured host and storage, not module globals', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('captured');
    const workspace = schedulerWorkspace(true);
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    configureStorage(storage);
    configureSchedulerHost(schedulerHost());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    // Reconfigure the module globals after scope creation: the composed
    // tool must keep using the values captured at setup.
    configureStorage(createInMemoryStorageBundle());
    configureSchedulerHost(schedulerHost({
      create() {
        throw new Error('module global host used');
      },
    }));

    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(tools).toHaveProperty('scheduler');
        const result = await tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-captured', messages: [] },
        );
        expect(result).toEqual({
          action: 'create',
          title: 'Scheduled job "Daily task" created',
          job: scheduledJob(),
          _visualization: {
            type: 'none',
            message: 'Scheduled job "Daily task" created',
          },
        });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('permission risk is captured at build time and not re-read from settings at execution', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('captured-risk');
    const workspace = schedulerWorkspace(true, 'low');
    configureStorage(mutableWorkspaceStorage(workspace));
    configureRuntimeHost(permissionAwareHost());
    configureSchedulerHost(schedulerHost());

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        let pendingRequestId: string | null = null;
        const tools = await buildAiSdkTools({
          ...buildOptions(workspacePath, workspace.id),
          broadcastFn: (message) => {
            if (message.type === 'ask.request' && 'requestId' in message) {
              pendingRequestId = message.requestId ?? null;
            }
          },
        });

        // Settings mutation after build must not change the captured risk.
        workspace.settings.scheduling = { enabled: true, permissionRisk: 'none' };

        const deniedPromise = tools['scheduler']!.execute!(
          createInput,
          { toolCallId: 'call-captured-risk', messages: [] },
        );
        await flush();
        expect(pendingRequestId).not.toBeNull();
        resolvePermission(pendingRequestId!, { type: 'permission', grant: 'deny' });
        expect(await deniedPromise).toEqual({ error: 'USER_REJECTION' });
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 scheduler visibility gates', () => {
  test('enabled, disabled, and scheduled-run settings gate the tool identically in composed and unscoped paths', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('visibility');

    // Composed path: disabled workspace omits the tool.
    const disabledWorkspace = schedulerWorkspace(false);
    configureStorage(createInMemoryStorageBundle({ workspaces: [disabledWorkspace] }));
    const disabledProcess = await createCurrentProcessScope();
    const disabledAgent = await createCurrentAgentScope(disabledProcess);
    try {
      await enterAgentScope(disabledAgent, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, disabledWorkspace.id));
        expect(tools).not.toHaveProperty('scheduler');
      });
    } finally {
      await disabledAgent.dispose();
      await disabledProcess.dispose();
    }

    // Composed path: enabled workspace exposes the tool; a scheduled-run
    // session omits it (current-session scheduled-job gate).
    const enabledWorkspace = schedulerWorkspace(true);
    const storage = createInMemoryStorageBundle({ workspaces: [enabledWorkspace] });
    storage.conversation.createSession(sessionFixture(enabledWorkspace.id));
    storage.conversation.createSession(sessionFixture(enabledWorkspace.id, {
      id: 'scheduled-run',
      metadata: { scheduledJobId: 'job-1' },
    }));
    configureStorage(storage);
    const enabledProcess = await createCurrentProcessScope();
    const enabledAgent = await createCurrentAgentScope(enabledProcess);
    try {
      await enterAgentScope(enabledAgent, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, enabledWorkspace.id));
        expect(tools).toHaveProperty('scheduler');

        const scheduledTools = await buildAiSdkTools(
          buildOptions(workspacePath, enabledWorkspace.id, 'scheduled-run'),
        );
        expect(scheduledTools).not.toHaveProperty('scheduler');
      });
    } finally {
      await enabledAgent.dispose();
      await enabledProcess.dispose();
    }

    // Unscoped path: the explicit fallback applies the same gate.
    configureStorage(storage);
    installSchedulerToolFallback();
    const unscoped = await buildAiSdkTools(buildOptions(workspacePath, enabledWorkspace.id));
    expect(unscoped).toHaveProperty('scheduler');
    const unscopedScheduled = await buildAiSdkTools(
      buildOptions(workspacePath, enabledWorkspace.id, 'scheduled-run'),
    );
    expect(unscopedScheduled).not.toHaveProperty('scheduler');
  });

  test('the gate reads only the current session truthy scheduledJobId like pre-C5', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('current-session-gate');
    const workspace = schedulerWorkspace(true);
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'scheduled-root',
      metadata: { scheduledJobId: 'job-1' },
    }));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'child-of-scheduled',
      parentId: 'scheduled-root',
      metadata: null,
    }));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'falsy-empty-string',
      metadata: { scheduledJobId: '' },
    }));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'falsy-zero',
      metadata: { scheduledJobId: 0 },
    }));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'truthy-number',
      metadata: { scheduledJobId: 42 },
    }));
    configureStorage(storage);

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const rootTools = await buildAiSdkTools(
          buildOptions(workspacePath, workspace.id, 'scheduled-root'),
        );
        expect(rootTools).not.toHaveProperty('scheduler');

        // Compatibility debt (C6 decision point): pre-C5 walked no
        // ancestry, so a child of a scheduled run keeps the tool visible.
        const childTools = await buildAiSdkTools(
          buildOptions(workspacePath, workspace.id, 'child-of-scheduled'),
        );
        expect(childTools).toHaveProperty('scheduler');

        const falsyString = await buildAiSdkTools(
          buildOptions(workspacePath, workspace.id, 'falsy-empty-string'),
        );
        expect(falsyString).toHaveProperty('scheduler');
        const falsyZero = await buildAiSdkTools(
          buildOptions(workspacePath, workspace.id, 'falsy-zero'),
        );
        expect(falsyZero).toHaveProperty('scheduler');
        const truthyNumber = await buildAiSdkTools(
          buildOptions(workspacePath, workspace.id, 'truthy-number'),
        );
        expect(truthyNumber).not.toHaveProperty('scheduler');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the domain service shares one availability predicate between the tool payload and the service', async () => {
    const workspace = schedulerWorkspace(true);
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    storage.conversation.createSession(sessionFixture(workspace.id));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'scheduled-run',
      metadata: { scheduledJobId: 'job-1' },
    }));
    configureStorage(storage);

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekSchedulerDomainKey);
      await expect(service.isEnabled(workspace.id, 'sess-sched')).resolves.toBe(true);
      await expect(service.isEnabled(workspace.id, 'scheduled-run')).resolves.toBe(false);
      await expect(service.isEnabled(workspace.id, 'missing-session')).resolves.toBe(true);
      await expect(service.isEnabled('ws-missing', 'sess-sched')).resolves.toBe(false);
      expect(service.tools).toHaveLength(1);
      expect(service.tools[0]!.name).toBe('scheduler');
      expect(service.tools[0]!.isEnabled).toBe(service.isEnabled);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 scheduler domain composition', () => {
  test('the current composition installs the scheduler domain plugin with a visible service-derived tool contribution', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.optional(capekSchedulerDomainKey);
      expect(service).toBeDefined();

      const contributed = agentScope.listTools().find(
        (tool) => tool.definition.name === 'scheduler',
      );
      expect(contributed).toBeDefined();
      expect(contributed?.id).toBe(SCHEDULER_TOOL_CONTRIBUTION_ID);
      expect(contributed?.order).toBe(SCHEDULER_TOOL_CONTRIBUTION_ORDER);
      expect(contributed?.pluginId).toBe(CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID);
      // Capability visibility only: the runtime settings gate is dynamic
      // per-workspace data and is not encoded in scope diagnostics.
      expect(contributed?.visible).toBe(true);
      expect(contributed?.hiddenReasons).toEqual([]);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a composed scope without the domain plugin exposes no scheduler tool with a fallback registered', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('no-domain');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost(schedulerHost());
    installSchedulerToolFallback();

    const withoutDomain = currentAgentPlugins().filter(
      (plugin) => plugin.id !== CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID,
    );
    const processScope = await createCurrentProcessScope();
    const agentScope = await createAgentScope(processScope, [...withoutDomain]);
    try {
      expect(agentScope.optional(capekSchedulerDomainKey)).toBeUndefined();
      expect(agentScope.listTools().some(
        (tool) => tool.definition.name === 'scheduler',
      )).toBe(false);

      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
        expect(tools).not.toHaveProperty('scheduler');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the C5 domains coexist in the current composition with deterministic inventory and order', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = agentScope.listTools();
      expect(tools.map((tool) => tool.definition.name)).toEqual([
        'retrieve-tool-output',
        'task',
        'skill',
        'memory',
        'workflow',
        'skill_manage',
        'session_search',
        'scheduler',
        'agent_memory',
        'agent_skill_manage',
      ]);
      const searchOrder = tools.find(
        (tool) => tool.definition.name === 'session_search',
      )?.order;
      const schedulerOrder = tools.find(
        (tool) => tool.definition.name === 'scheduler',
      )?.order;
      const taskOrder = tools.find((tool) => tool.definition.name === 'task')?.order;
      const workflowOrder = tools.find((tool) => tool.definition.name === 'workflow')?.order;
      const skillOrder = tools.find((tool) => tool.definition.name === 'skill')?.order;
      const memoryOrder = tools.find((tool) => tool.definition.name === 'memory')?.order;
      const skillManageOrder = tools.find((tool) => tool.definition.name === 'skill_manage')?.order;
      expect(schedulerOrder).toBeGreaterThan(searchOrder ?? 0);
      expect(taskOrder ?? 0).toBeLessThan(skillOrder ?? 0);
      expect(skillOrder ?? 0).toBeLessThan(memoryOrder ?? 0);
      expect(memoryOrder ?? 0).toBeLessThan(workflowOrder ?? 0);
      expect(workflowOrder ?? 0).toBeLessThan(skillManageOrder ?? 0);
      expect(skillManageOrder ?? 0).toBeLessThan(searchOrder ?? 0);
      expect(tools.find((tool) => tool.definition.name === 'session_search')?.pluginId)
        .toBe(CURRENT_SESSION_SEARCH_DOMAIN_PLUGIN_ID);
      expect(tools.find((tool) => tool.definition.name === 'scheduler')?.pluginId)
        .toBe(CURRENT_SCHEDULER_DOMAIN_PLUGIN_ID);
      expect(tools.find((tool) => tool.definition.name === 'task')?.pluginId)
        .toBe(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID);
      expect(tools.find((tool) => tool.definition.name === 'workflow')?.pluginId)
        .toBe(CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID);
      expect(tools.find((tool) => tool.definition.name === 'skill')?.pluginId)
        .toBe(CURRENT_SKILLS_DOMAIN_PLUGIN_ID);
      expect(tools.find((tool) => tool.definition.name === 'memory')?.pluginId)
        .toBe(CURRENT_MEMORY_DOMAIN_PLUGIN_ID);

      const schedulerService = agentScope.require(capekSchedulerDomainKey);
      enterAgentScope(agentScope, () => {
        const payloads = getContributedDomainToolPayloads();
        expect(payloads?.size).toBe(9);
        expect(payloads?.get('scheduler')).toBe(schedulerService.tools[0]);
        expect(payloads?.get('session_search')).toBeDefined();
        expect(payloads?.get('task')).toBeDefined();
        expect(payloads?.get('workflow')).toBeDefined();
        expect(payloads?.get('skill')).toBeDefined();
        expect(payloads?.get('memory')).toBeDefined();
        expect(payloads?.get('skill_manage')).toBeDefined();
        expect(payloads?.get('agent_memory')).toBeDefined();
        expect(payloads?.get('agent_skill_manage')).toBeDefined();
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('unscoped compatibility fallback', () => {
  test('the explicitly installed fallback keeps the unscoped tool behavior', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('fallback');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost(schedulerHost());
    installSchedulerToolFallback();

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    expect(tools).toHaveProperty('scheduler');
    const result = await tools['scheduler']!.execute!(
      createInput,
      { toolCallId: 'call-fallback', messages: [] },
    );
    expect(result).toEqual({
      action: 'create',
      title: 'Scheduled job "Daily task" created',
      job: scheduledJob(),
      _visualization: {
        type: 'none',
        message: 'Scheduled job "Daily task" created',
      },
    });
  });

  test('without a registered fallback the unscoped path omits the tool', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('no-fallback');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost(schedulerHost());
    expect(getDomainToolFallback('scheduler')).toBeNull();

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    expect(tools).not.toHaveProperty('scheduler');
  });

  test('resetDomainToolFallbacksForTests resets the scheduler fallback registry entry', () => {
    installSchedulerToolFallback();
    expect(getDomainToolFallback('scheduler')).not.toBeNull();
    resetDomainToolFallbacksForTests();
    expect(getDomainToolFallback('scheduler')).toBeNull();
  });

  test('the unscoped gate keeps the current-session semantics for a child of a scheduled run', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('unscoped-child');
    const workspace = schedulerWorkspace(true);
    const storage = createInMemoryStorageBundle({ workspaces: [workspace] });
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'scheduled-root',
      metadata: { scheduledJobId: 'job-1' },
    }));
    storage.conversation.createSession(sessionFixture(workspace.id, {
      id: 'child-of-scheduled',
      parentId: 'scheduled-root',
      metadata: null,
    }));
    configureStorage(storage);
    installSchedulerToolFallback();

    const rootTools = await buildAiSdkTools(
      buildOptions(workspacePath, workspace.id, 'scheduled-root'),
    );
    expect(rootTools).not.toHaveProperty('scheduler');
    const childTools = await buildAiSdkTools(
      buildOptions(workspacePath, workspace.id, 'child-of-scheduled'),
    );
    expect(childTools).toHaveProperty('scheduler');
  });

  test('the unscoped fallback resolves the scheduler host at execution time like pre-C5', async () => {
    const { workspacePath } = await schedulerWorkspaceDir('fallback-host');
    const workspace = schedulerWorkspace(true);
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspace] }));
    configureSchedulerHost();
    installSchedulerToolFallback();
    // Configured after installation: pre-C5 read the module host at
    // execution time, and the fallback keeps that.
    configureSchedulerHost(schedulerHost());

    const tools = await buildAiSdkTools(buildOptions(workspacePath, workspace.id));
    const result = await tools['scheduler']!.execute!(
      createInput,
      { toolCallId: 'call-fallback-host', messages: [] },
    );
    expect(result).toEqual({
      action: 'create',
      title: 'Scheduled job "Daily task" created',
      job: scheduledJob(),
      _visualization: {
        type: 'none',
        message: 'Scheduled job "Daily task" created',
      },
    });
  });
});
