import { describe, expect, mock, test } from 'bun:test';
import type { Preconfig, ScheduledJob } from '@jean2/sdk';
import type {
  ScheduledRunSessionPort,
  ScheduledRunWorkspacePort,
} from '@/application/ports/scheduling';
import type { ScheduledJobRunnerDeps } from '@/infrastructure/scheduling/scheduled-job-runner';

const executeChildSession = mock(async (_input: unknown) => ({ error: 'run failed' }));
const findProviderFromModel = mock(() => 'inferred-provider');

mock.module('@capekai/core/providers', () => ({
  executeChildSession,
  findProviderFromModel,
}));

const { createScheduledJobRunner } = await import('@/infrastructure/scheduling/scheduled-job-runner');

const preconfig = {
  id: 'preconfig-1',
  name: 'Scheduled',
  description: '',
  systemPrompt: '',
  tools: ['scheduler', 'shell'],
  model: null,
  provider: null,
  variant: null,
  settings: null,
  isDefault: true,
  mode: 'primary',
  canSpawnSubagents: false,
  allowSelfAsSubagent: false,
  skills: null,
} as Preconfig;

const job = {
  id: 'job-1',
  workspaceId: 'workspace-1',
  name: 'Nightly',
  prompt: 'Run checks',
  preconfigId: 'preconfig-1',
  reuseSession: false,
  includeHistory: false,
  lastRunSessionId: null,
  autoApproveSeverity: null,
} as ScheduledJob;

function dependencies(events: string[]): ScheduledJobRunnerDeps {
  const sessions: ScheduledRunSessionPort = {
    createSession: (session) => {
      events.push(`create:${session.selectedModel}:${session.selectedProvider}`);
      return session as never;
    },
    getSession: () => null,
  };
  const workspaces: ScheduledRunWorkspacePort = {
    getWorkspace: () => ({ path: '/workspace' } as never),
    getAutoApproveSeverity: () => 'medium',
  };
  return {
    repository: {
      markRun: (_id, sessionId) => events.push(`mark:${sessionId}`),
      markError: (_id, error) => events.push(`error:${error}`),
    },
    sessions,
    workspaces,
    preconfigs: {
      getPreconfig: async () => preconfig,
      getDefaultPreconfig: async () => preconfig,
    },
    modelsConfig: {
      getModelsConfig: () => ({ defaultModel: 'default-model', defaultProvider: 'default-provider' }),
    },
  };
}

describe('scheduled job runner', () => {
  test('filters recursive scheduling and records run before the result error', async () => {
    executeChildSession.mockImplementationOnce(async (rawInput) => {
      const input = rawInput as {
        modelId: string;
        providerId: string;
        preconfig: Preconfig;
        workspacePath?: string;
      };
      expect(input.modelId).toBe('default-model');
      expect(input.providerId).toBe('inferred-provider');
      expect(input.preconfig.tools).toEqual(['shell']);
      expect(input.workspacePath).toBe('/workspace');
      return { error: 'run failed' };
    });
    const events: string[] = [];

    await createScheduledJobRunner(dependencies(events)).run(job);

    expect(events[0]).toMatch(/^create:/);
    expect(events.slice(-2)).toEqual([expect.stringMatching(/^mark:/), 'error:run failed']);
    expect(findProviderFromModel).toHaveBeenCalledWith('default-model');
  });
});
