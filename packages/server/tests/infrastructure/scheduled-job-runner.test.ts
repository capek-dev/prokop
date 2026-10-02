import { beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig, ScheduledJob } from '@prokopai/sdk';
import type {
  ScheduledRunSessionPort,
  ScheduledRunWorkspacePort,
} from '@/application/ports/scheduling';
import { installHeadlessExecutionPort } from '@/application/ports/headless-execution';
import type { HeadlessSessionRunInput } from '@/application/ports/headless-execution';
import type { ScheduledJobRunnerDeps } from '@/infrastructure/scheduling/scheduled-job-runner';

const { createScheduledJobRunner } = await import('@/infrastructure/scheduling/scheduled-job-runner');

const preconfig = {
  id: 'preconfig-1',
  name: 'Scheduled',
  description: '',
  systemPrompt: '',
  tools: ['shell'],
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
  permissionMode: null,
} as ScheduledJob;

function dependencies(events: string[], runs: HeadlessSessionRunInput[]): ScheduledJobRunnerDeps {
  const sessions: ScheduledRunSessionPort = {
    createSession: (session) => {
      events.push(`create:${session.harness}:${session.selectedModel}:${session.selectedProvider}`);
      return session as never;
    },
    getSession: () => null,
  };
  const workspaces: ScheduledRunWorkspacePort = {
    getWorkspace: () => ({ path: '/workspace' } as never),
    permissionMode: () => 'extended',
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
      getModelsConfig: () => ({ defaultModel: 'definitely-not-a-registered-model', defaultProvider: 'default-provider' }),
    },
    headless: {
      async run(input) {
        runs.push(input);
        return {};
      },
    },
  };
}

describe('scheduled job runner', () => {
  beforeEach(() => {
    // Other suites in the same process install a global headless port; reset
    // it so the fallback paths here test the real "no port installed" state.
    installHeadlessExecutionPort(null);
  });

  test('records the run before the result error', async () => {
    const events: string[] = [];
    const runs: HeadlessSessionRunInput[] = [];
    const deps = dependencies(events, runs);
    deps.headless = {
      async run(input) {
        runs.push(input);
        return { error: 'run failed' };
      },
    };

    await createScheduledJobRunner(deps).run(job);

    expect(runs).toHaveLength(1);
    expect(runs[0].modelId).toBe('definitely-not-a-registered-model');
    // Unknown model id: the neutral provider lookup misses and the models
    // config default provider applies.
    expect(runs[0].providerId).toBe('default-provider');
    expect(runs[0].preconfig.tools).toEqual(['shell']);
    expect(runs[0].workspacePath).toBe('/workspace');
    expect(events[0]).toMatch(/^create:prokop:/);
    expect(events.slice(-2)).toEqual([expect.stringMatching(/^mark:/), 'error:run failed']);
  });

  test('dispatches by the persisted job harness and defaults legacy jobs to prokop', async () => {
    const events: string[] = [];
    const runs: HeadlessSessionRunInput[] = [];
    const runner = createScheduledJobRunner(dependencies(events, runs));

    await runner.run({ ...job, harness: 'codex-cli' } as ScheduledJob);
    await runner.run(job);

    const creates = events.filter(event => event.startsWith('create:'));
    expect(creates).toEqual([
      expect.stringMatching(/^create:codex-cli:/),
      expect.stringMatching(/^create:prokop:/),
    ]);
    expect(runs.map(run => run.harness)).toEqual(['codex-cli', 'prokop']);
    for (const run of runs) {
      expect(run.parentSessionId).toBe(run.childSessionId);
    }
  });

  test('fails closed with a recorded error when no headless port is available', async () => {
    const events: string[] = [];
    const deps = dependencies(events, []);
    delete (deps as { headless?: unknown }).headless;

    await createScheduledJobRunner(deps).run(job);

    expect(events).toEqual([
      expect.stringMatching(/^create:prokop:/),
      expect.stringMatching(/^mark:/),
      'error:Scheduled execution is unavailable',
    ]);
  });

  test('a model-less preconfig inherits the configured default variant', async () => {
    const created: Array<{ selectedVariant: string | null }> = [];
    const deps = dependencies([], []);
    deps.modelsConfig = {
      getModelsConfig: () => ({
        defaultModel: 'glm-5.3',
        defaultProvider: 'zhipu-coding',
        defaultVariant: 'max',
        providers: [
          { id: 'zhipu-coding', models: [{ id: 'glm-5.3', variants: { high: {}, max: {} } }] },
        ],
      }),
    };
    const originalCreate = deps.sessions.createSession.bind(deps.sessions);
    deps.sessions = {
      ...deps.sessions,
      createSession: (session) => {
        created.push(session as { selectedVariant: string | null });
        return originalCreate(session);
      },
    };

    await createScheduledJobRunner(deps).run(job);

    expect(created).toHaveLength(1);
    expect(created[0].selectedVariant).toBe('max');
  });

  test('a harness pin seeds the job model on the matching harness', async () => {
    const events: string[] = [];
    const runs: HeadlessSessionRunInput[] = [];
    const deps = dependencies(events, runs);
    const pinned = { ...preconfig, model: 'gpt-5.2-codex', modelHarness: 'codex-cli' } as Preconfig;
    deps.preconfigs = {
      getPreconfig: async () => pinned,
      getDefaultPreconfig: async () => pinned,
    };

    await createScheduledJobRunner(deps).run({ ...job, harness: 'codex-cli' } as ScheduledJob);

    expect(runs[0].modelId).toBe('gpt-5.2-codex');
    expect(events[0]).toMatch(/^create:codex-cli:gpt-5.2-codex:/);
  });

  test('a harness pin is ignored on a non-matching harness job', async () => {
    const events: string[] = [];
    const runs: HeadlessSessionRunInput[] = [];
    const deps = dependencies(events, runs);
    const pinned = { ...preconfig, model: 'gpt-5.2-codex', modelHarness: 'codex-cli' } as Preconfig;
    deps.preconfigs = {
      getPreconfig: async () => pinned,
      getDefaultPreconfig: async () => pinned,
    };

    await createScheduledJobRunner(deps).run(job);

    expect(runs[0].modelId).toBe('definitely-not-a-registered-model');
    expect(events[0]).toMatch(/^create:prokop:definitely-not-a-registered-model:/);
  });
});
