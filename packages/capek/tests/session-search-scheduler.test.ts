import { afterEach, describe, expect, test } from 'bun:test';
import type { ScheduledJob, Session, Workspace } from '@capekai/types';
import {
  configureSessionSearchHost,
  executeSessionSearchTool,
  type SessionSearchHost,
} from '../src/session-search';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { executeSchedulerTool } from '../src/scheduler/scheduler-tool';

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  path: '/workspace',
  isVirtual: false,
  additionalPaths: [],
  settings: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const session = (id: string, workspaceId = workspace.id): Session => ({
  id,
  workspaceId,
  preconfigId: null,
  title: id,
  status: 'active',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  metadata: null,
  selectedModel: null,
  selectedProvider: null,
  selectedVariant: null,
  parentId: null,
  agentName: null,
  subagentStatus: null,
  runningAt: null,
  compacting: false,
  tags: [],
  autoApproveSeverity: null,
  agentId: null,
});

function searchHost(overrides: Partial<SessionSearchHost> = {}): SessionSearchHost {
  return {
    getWorkspace: async () => workspace,
    getSession: async (id) => session(id),
    listWorkspaceSessions: async () => [session('current'), session('other')],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 2,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
    ...overrides,
  };
}

function scheduledJob(id = 'job-1'): ScheduledJob {
  return {
    id,
    workspaceId: workspace.id,
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
    originSessionId: 'current',
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

afterEach(() => {
  configureSessionSearchHost();
  configureSchedulerHost();
});

describe('session search host seam', () => {
  test('keeps list read-only and applies the existing default list limit', async () => {
    let asked = false;
    const sessions = Array.from({ length: 12 }, (_, index) => session(`session-${index}`));
    configureSessionSearchHost(searchHost({ listWorkspaceSessions: async () => sessions }));

    const result = await executeSessionSearchTool(
      { action: 'list' },
      workspace.id,
      'session-0',
      false,
      'high',
      async () => {
        asked = true;
        return false;
      },
    );

    expect(asked).toBe(false);
    expect(result.success).toBe(true);
    expect(result.sessions).toHaveLength(10);
  });

  test('passes search scope, roles, limits, and sort to the host', async () => {
    let received: Parameters<SessionSearchHost['searchMessages']>[0] | undefined;
    configureSessionSearchHost(searchHost({
      async searchMessages(options) {
        received = options;
        return [];
      },
    }));

    await executeSessionSearchTool(
      { query: 'needle', scope: 'current_session', limit: 99, roleFilter: ['tool'], sort: 'newest' },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(received).toEqual({
      query: 'needle',
      workspaceId: workspace.id,
      agentId: undefined,
      sessionId: 'current',
      roleFilter: ['tool'],
      limit: 20,
      sort: 'newest',
    });
  });

  test('rejects agent scope outside an agent session', async () => {
    let searched = false;
    configureSessionSearchHost(searchHost({
      async searchMessages() {
        searched = true;
        return [];
      },
    }));

    const searchResult = await executeSessionSearchTool(
      { query: 'secret', scope: 'agent' },
      workspace.id,
      'current',
      false,
      'none',
    );
    const listResult = await executeSessionSearchTool(
      { action: 'list', scope: 'agent' },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(searchResult.success).toBe(false);
    expect(searchResult.error).toContain('agent session');
    expect(listResult.success).toBe(false);
    expect(listResult.mode).toBe('list');
    expect(listResult.error).toContain('agent session');
    expect(searched).toBe(false);
  });

  test('reads around the latest message and bounds content', async () => {
    configureSessionSearchHost(searchHost({
      getLatestMessage: async () => ({ id: 'message-2', timestamp: 2 }),
      listMessagesBefore: async () => [{ id: 'message-1', role: 'user', timestamp: 1 }],
      getMessageSummary: async (id) => ({
        role: id === 'message-1' ? 'user' : 'assistant',
        timestamp: id === 'message-1' ? 1 : 2,
        content: 'x'.repeat(2100),
        toolName: '',
      }),
      countMessagesBefore: async () => 1,
    }));

    const result = await executeSessionSearchTool(
      { sessionId: 'other', window: 4 },
      workspace.id,
      'current',
      false,
      'none',
    );

    expect(result.success).toBe(true);
    expect(result.anchorInferred).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages?.[0]?.content.length).toBe(2003);
  });
});

describe('scheduler host seam', () => {
  test('keeps list read-only', async () => {
    let asked = false;
    configureSchedulerHost(schedulerHost());

    const result = await executeSchedulerTool(
      { action: 'list' },
      workspace.id,
      'current',
      'high',
      async () => {
        asked = true;
        return false;
      },
    );

    expect(asked).toBe(false);
    expect(result.jobs).toHaveLength(1);
  });

  test('stops mutating actions after permission denial', async () => {
    configureSchedulerHost(schedulerHost());
    const result = await executeSchedulerTool(
      { action: 'remove', jobId: 'job-1' },
      workspace.id,
      'current',
      'medium',
      async () => false,
    );

    expect(result).toEqual({
      success: false,
      action: 'remove',
      title: 'Permission denied',
      error: 'USER_REJECTION',
    });
  });

  test('rejects cross-workspace job mutations', async () => {
    let deleted = false;
    const foreign = scheduledJob('foreign-job');
    foreign.workspaceId = 'other-workspace';
    configureSchedulerHost(schedulerHost({
      get: () => foreign,
      delete() {
        deleted = true;
        return true;
      },
    }));

    const result = await executeSchedulerTool(
      { action: 'remove', jobId: foreign.id },
      workspace.id,
      'current',
      'none',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('workspace');
    expect(deleted).toBe(false);
  });

  test('delegates create and immediate trigger to the host', async () => {
    let created = false;
    let triggered = false;
    const job = scheduledJob();
    configureSchedulerHost(schedulerHost({
      create(_workspaceId, input) {
        created = input.originSessionId === 'current';
        return job;
      },
      trigger() {
        triggered = true;
      },
    }));

    const createResult = await executeSchedulerTool(
      { action: 'create', name: 'Daily task', prompt: 'Run', schedule: { type: 'daily', time: '09:00' } },
      workspace.id,
      'current',
      'none',
    );
    const triggerResult = await executeSchedulerTool(
      { action: 'trigger', jobId: job.id },
      workspace.id,
      'current',
      'none',
    );

    expect(createResult.success).toBe(true);
    expect(created).toBe(true);
    expect(triggerResult.success).toBe(true);
    expect(triggered).toBe(true);
  });
});
