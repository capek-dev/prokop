/**
 * C5 workflow domain slice characterization.
 *
 * Pins the workflow domain plugin ownership: the composed `workflow` tool
 * contribution (id, order, plugin, payload) with the dynamic definition
 * resolved from scope-captured sources with no global fallback, the
 * composed depth gate, the workspace settings gate in buildWorkspaceTools,
 * the explicit unscoped fallback, the named shared orchestrator-session
 * contract and its provider identity, and the exact decompose → fan out →
 * synthesize behavior over injected deps (concurrency limit, partial and
 * all-leaf failure, synthesis fallback, cancellation, depth, overrides,
 * decomposer and synthesizer prompts and malformed behavior, subagent
 * sanitization, and the subtask cap).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Preconfig, Session, Workspace } from '@capekai/types';
import { buildAiSdkTools } from '../src/core/build-tools';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { resetDomainToolFallbacksForTests } from '../src/runtime/domain-tool-source';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import {
  CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID,
  WORKFLOW_TOOL_CONTRIBUTION_ID,
  WORKFLOW_TOOL_CONTRIBUTION_ORDER,
  capekWorkflowDomainKey,
  installWorkflowToolFallback,
} from '../src/plugins/workflow-domain';
import { orchestratorSessionProviderPlugin } from '../src/plugins/orchestrator-session';
import {
  capekOrchestratorSessionKey,
  type OrchestratorSessionContract,
} from '../src/plugins/service-keys';
import { runOrchestratorSession } from '../src/workflow/orchestrator-session';
import {
  executeWorkflowWithDeps,
  MAX_CONCURRENCY,
  type WorkflowServiceDeps,
} from '../src/workflow/execution';
import {
  decomposeTaskWithDeps,
  MAX_SUBTASKS,
  type DecomposeTaskDeps,
} from '../src/workflow/decomposer';
import { synthesizeResultsWithDeps } from '../src/workflow/synthesizer';
import { createAgentScope, createProcessScope } from '../src/kernel/kernel';
import { configureStorage, createSession } from '../src/storage/runtime';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { clearCache } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';
import type { SubagentInput, SubagentOutput } from '../src/subagent/task-tool';

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c5-workflow-${label}-`));
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
        tempDir: '/tmp/capek-c5-workflow-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

const EXPLORE_PRECONFIG = {
  id: 'explore',
  name: 'Explore',
  description: 'Research tasks',
  mode: 'subagent',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
} as Preconfig;

const RESEARCH_PRECONFIG = {
  id: 'research',
  name: 'Research',
  description: 'Deep research',
  mode: 'subagent',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
} as Preconfig;

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource({
    get: async () => null,
    getDefault: async () => null,
    getForAgent: async () => null,
    list: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
    listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
  });
  configureAgentSource();
  configureInstructionSource();
  configureWorkspaceToolDiscovery();
  installWorkflowToolFallback();
}

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  clearCache();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'root',
    workspaceId: 'ws-wf',
    preconfigId: 'agent-x',
    title: null,
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as Session;
}

function workflowWorkspace(enabled: boolean, id = 'ws-wf'): Workspace {
  return {
    id,
    name: 'Workflow workspace',
    path: '/workspace/workflow',
    isVirtual: false,
    additionalPaths: [],
    settings: {
      autoApproveSeverity: 'low',
      memory: { enabled: false, permissionRisk: 'low' },
      skills: { managementEnabled: false, permissionRisk: 'low' },
      sessionSearch: { enabled: false, permissionRisk: 'none', includeToolResults: false },
      workflow: { enabled },
      scheduling: { enabled: false, permissionRisk: 'none' },
    },
    createdAt: '',
    updatedAt: '',
  };
}

interface FakeWorkflowState {
  leaves: SubagentInput[];
  orchestratorCalls: Array<Parameters<OrchestratorSessionContract['run']>[0]>;
  leafResults: Array<{ task_id: string; result: string; error?: string; structuredResult?: Record<string, unknown> }>;
  synthesizerCalls: number;
}

function makeDeps(state: FakeWorkflowState, overrides: Partial<WorkflowServiceDeps> = {}): WorkflowServiceDeps {
  const base: WorkflowServiceDeps = {
    canSpawn: () => true,
    listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
    executeLeaf: async (input) => {
      state.leaves.push(input);
      const preset = state.leafResults.shift();
      return (preset ?? { task_id: input.prompt, result: `result:${input.prompt}` }) as SubagentOutput;
    },
    orchestrator: {
      run: async (options) => {
        state.orchestratorCalls.push(options);
        return { text: 'raw', json: null, sessionId: 'orch-1' };
      },
    },
    ...overrides,
  };
  return base;
}

describe('C5 workflow composed scope ownership', () => {
  beforeEach(() => configureEnvironment());

  test('the current composition contributes the workflow tool with the pinned id, order, plugin, and payload', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = agentScope.listTools();
      const workflowEntry = tools.find((entry) => entry.definition.name === 'workflow');
      expect(workflowEntry).toBeDefined();
      expect(workflowEntry!.id).toBe(WORKFLOW_TOOL_CONTRIBUTION_ID);
      expect(workflowEntry!.order).toBe(WORKFLOW_TOOL_CONTRIBUTION_ORDER);
      expect(workflowEntry!.pluginId).toBe(CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID);
      expect(workflowEntry!.visible).toBe(true);
      expect(workflowEntry!.definition.timeout).toBe(600000);

      const service = agentScope.require(capekWorkflowDomainKey);
      expect(service.tools.map((tool) => tool.name)).toEqual(['workflow']);
      expect(service.tools[0].resolveDefinition).toBeDefined();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed payload resolves the dynamic definition from scope-captured sources and never falls back to globals', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'root', preconfigId: 'agent-x' }));
    const scopePreconfigs = [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG];
    configurePreconfigSource({
      get: async () => null,
      getDefault: async () => null,
      getForAgent: async () => null,
      list: async () => scopePreconfigs,
      listSubagents: async () => scopePreconfigs,
    });

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      // Reconfigure the module-level globals AFTER composition with a decoy
      // subagent set; the composed definition must reflect the scope's
      // captured sources.
      const decoyPreconfigs = [{ ...EXPLORE_PRECONFIG, id: 'global-only' }];
      configurePreconfigSource({
        get: async () => null,
        getDefault: async () => null,
        getForAgent: async () => null,
        list: async () => decoyPreconfigs,
        listSubagents: async () => decoyPreconfigs,
      });

      const service = agentScope.require(capekWorkflowDomainKey);
      const definition = await service.resolveDefinition({
        sessionId: 'root',
        canSpawnSubagents: true,
      });
      expect(definition).not.toBeNull();
      expect(definition!.allowedSubagentIds).toEqual(['explore', 'research']);
      expect(definition!.description).toContain('Available leaf agent types: explore, research');
      expect(definition!.description).not.toContain('global-only');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed depth gate blocks the workflow tool at maximum depth', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'root', preconfigId: 'agent-x' }));
    createSession(makeSession({ id: 'child-1', parentId: 'root', preconfigId: 'explore' }));
    createSession(makeSession({ id: 'child-2', parentId: 'child-1', preconfigId: 'explore' }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekWorkflowDomainKey);
      expect(await service.canSpawn('root')).toBe(true);
      expect(await service.canSpawn('child-2')).toBe(false);
      expect(await service.tools[0].isEnabled?.('ws-wf', 'child-2')).toBe(false);

      const blocked = await service.resolveDefinition({
        sessionId: 'child-2',
        canSpawnSubagents: true,
      });
      expect(blocked).toBeNull();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the workspace settings gate stays in buildWorkspaceTools for the composed path', async () => {
    const workspacePath = join(await tempDir('gate'), 'workspace');
    await mkdir(workspacePath, { recursive: true });
    configureStorage(createInMemoryStorageBundle({ workspaces: [workflowWorkspace(false)] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const disabled = await buildAiSdkTools({
          toolNames: [],
          workspacePath,
          workspaceId: 'ws-wf',
          sessionId: 'root',
          canSpawnSubagents: true,
          allowedSkills: null,
          agentId: null,
        });
        expect(Object.keys(disabled)).toEqual(['task', 'retrieve-tool-output']);
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }

    configureStorage(createInMemoryStorageBundle({ workspaces: [workflowWorkspace(true)] }));
    const processScope2 = await createCurrentProcessScope();
    const agentScope2 = await createCurrentAgentScope(processScope2);
    try {
      await enterAgentScope(agentScope2, async () => {
        const enabled = await buildAiSdkTools({
          toolNames: [],
          workspacePath,
          workspaceId: 'ws-wf',
          sessionId: 'root',
          canSpawnSubagents: true,
          allowedSkills: null,
          agentId: null,
        });
        expect(Object.keys(enabled)).toEqual(['task', 'workflow', 'retrieve-tool-output']);
        const workflowTool = enabled.workflow as { description?: string };
        expect(String(workflowTool.description ?? '')).toContain('Available leaf agent types: explore, research');
      });
    } finally {
      await agentScope2.dispose();
      await processScope2.dispose();
    }
  });

  test('the explicitly installed fallback keeps the unscoped workflow tool behavior', async () => {
    const workspacePath = join(await tempDir('fallback'), 'workspace');
    await mkdir(workspacePath, { recursive: true });
    configureStorage(createInMemoryStorageBundle({ workspaces: [workflowWorkspace(true)] }));

    const enabled = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-wf',
      sessionId: 'root',
      canSpawnSubagents: true,
      allowedSkills: null,
      agentId: null,
    });
    expect(Object.keys(enabled)).toEqual(['workflow', 'retrieve-tool-output']);

    const disabled = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-wf',
      sessionId: 'root',
      canSpawnSubagents: false,
      allowedSkills: null,
      agentId: null,
    });
    expect(Object.keys(disabled)).toEqual(['retrieve-tool-output']);

    resetDomainToolFallbacksForTests();
    const cleared = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-wf',
      sessionId: 'root',
      canSpawnSubagents: true,
      allowedSkills: null,
      agentId: null,
    });
    expect(Object.keys(cleared)).toEqual(['retrieve-tool-output']);
  });

  test('the orchestrator-session contract has the pinned id and scope and the provider wraps the exact implementation identity', async () => {
    expect(capekOrchestratorSessionKey.scope).toBe('agent');
    expect(capekOrchestratorSessionKey.id).toBe('capek.orchestrator-session');

    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [
      orchestratorSessionProviderPlugin('test.orchestrator-session'),
    ]);
    try {
      const contract = agentScope.require(capekOrchestratorSessionKey);
      expect(contract.run).toBe(runOrchestratorSession);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 workflow execution with injected deps', () => {
  test('pins the concurrency and subtask constants', () => {
    expect(MAX_CONCURRENCY).toBe(5);
    expect(MAX_SUBTASKS).toBe(50);
  });

  test('explicit subtasks skip decomposition and preserve ordered leaf results through synthesis', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [
        { task_id: 'a', result: 'r:first' },
        { task_id: 'b', result: 'r:second' },
      ],
      synthesizerCalls: 0,
    };
    const deps = makeDeps(state, {
      orchestrator: {
        run: async (options) => {
          state.orchestratorCalls.push(options);
          return { text: 'synthesized', json: null, sessionId: 'orch-1' };
        },
      },
    });

    const result = await executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: [
        { prompt: 'first', preconfigId: 'explore' },
        { prompt: 'second', preconfigId: 'explore' },
      ],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    expect(result.error).toBeUndefined();
    expect(result.subtaskCount).toBe(2);
    expect(result.result).toContain('Workflow completed. 2 sub-agent(s) executed (0 failed).');
    expect(result.result).toContain('synthesized');
    expect(state.orchestratorCalls).toHaveLength(1);
    expect(state.orchestratorCalls[0].agentName).toBe('synthesizer');
    expect(state.leaves.map((leaf) => leaf.subagent_type)).toEqual(['explore', 'explore']);
  });

  test('all-leaf failure bails before synthesis with the exact error', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [
        { task_id: 'a', result: '', error: 'leaf failed' },
      ],
      synthesizerCalls: 0,
    };
    const deps = makeDeps(state, {
      orchestrator: {
        run: async () => {
          state.orchestratorCalls.push({ agentName: 'must-not-run' } as never);
          return { text: 'unused', json: null, sessionId: 'orch-1' };
        },
      },
    });

    const result = await executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: [{ prompt: 'first', preconfigId: 'explore' }],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    expect(result.error).toBe('All 1 sub-agent(s) failed. Errors: Subtask 1: leaf failed');
    expect(result.result).toBe('');
    expect(state.orchestratorCalls).toHaveLength(0);
  });

  test('partial leaf failure still synthesizes with the failure recorded', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [
        { task_id: 'a', result: 'ok' },
        { task_id: 'b', result: '', error: 'boom' },
      ],
      synthesizerCalls: 0,
    };
    let synthesizedLeafResults: unknown = null;
    const deps = makeDeps(state, {
      orchestrator: {
        run: async (options) => {
          synthesizedLeafResults = options;
          return { text: 'partial-synthesis', json: null, sessionId: 'orch-1' };
        },
      },
    });

    const result = await executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: [
        { prompt: 'first', preconfigId: 'explore' },
        { prompt: 'second', preconfigId: 'explore' },
      ],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    expect(result.error).toBeUndefined();
    expect(result.result).toContain('Workflow completed. 2 sub-agent(s) executed (1 failed).');
    expect(result.result).toContain('partial-synthesis');
    const synthOptions = synthesizedLeafResults as { systemPrompt: string };
    expect(synthOptions.systemPrompt).toContain('Sub-agent 1 [success]:');
    expect(synthOptions.systemPrompt).toContain('Sub-agent 2 [FAILED]:');
    expect(synthOptions.systemPrompt).toContain('Error: boom');
  });

  test('synthesis failure falls back to raw leaf results with the exact error', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [{ task_id: 'a', result: 'raw-text' }],
      synthesizerCalls: 0,
    };
    const deps = makeDeps(state, {
      orchestrator: {
        run: async () => {
          throw new Error('synthesizer exploded');
        },
      },
    });

    const result = await executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: [{ prompt: 'first', preconfigId: 'explore' }],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    expect(result.error).toBe('Synthesis failed: synthesizer exploded');
    expect(result.result).toContain('Workflow completed but synthesis failed. 1 sub-agent(s) executed (0 failed).');
    expect(result.result).toContain('Returning raw sub-agent results:');
    expect(result.result).toContain('Sub-agent 1 [success]:\nraw-text');
  });

  test('abort after leaves returns the interrupted result without synthesis', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [{ task_id: 'a', result: 'done' }],
      synthesizerCalls: 0,
    };
    const controller = new AbortController();
    const deps = makeDeps(state, {
      executeLeaf: async (input) => {
        state.leaves.push(input);
        controller.abort();
        return { task_id: input.prompt, result: 'done' };
      },
    });

    const result = await executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: [{ prompt: 'first', preconfigId: 'explore' }],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
      abortSignal: controller.signal,
    }, deps);

    expect(result.error).toBe('Workflow was interrupted');
    expect(result.subtaskCount).toBe(1);
    expect(state.orchestratorCalls).toHaveLength(0);
  });

  test('the depth gate and invalid target validation run before any leaves', async () => {
    const state: FakeWorkflowState = { leaves: [], orchestratorCalls: [], leafResults: [], synthesizerCalls: 0 };
    const deps = makeDeps(state, { canSpawn: () => false });

    const depth = await executeWorkflowWithDeps({ prompt: 'analyze' }, { sessionId: 'root' }, deps);
    expect(depth.error).toBe('Maximum subagent depth reached. Cannot spawn workflow agents.');
    expect(depth.subtaskCount).toBe(0);
    expect(state.leaves).toHaveLength(0);

    const allowedDeps = makeDeps(state);
    const leafBlocked = await executeWorkflowWithDeps(
      { prompt: 'analyze', leafPreconfigId: 'research' },
      { sessionId: 'root', allowedSubagentIds: ['explore'] },
      allowedDeps,
    );
    expect(leafBlocked.error).toBe('Subagent type "research" is not allowed for this workflow.');

    const subtaskBlocked = await executeWorkflowWithDeps(
      { prompt: 'analyze', subtasks: [{ prompt: 'x', preconfigId: 'research' }] },
      { sessionId: 'root', allowedSubagentIds: ['explore'] },
      allowedDeps,
    );
    expect(subtaskBlocked.error).toBe('Subagent type "research" is not allowed for this workflow.');
    expect(state.leaves).toHaveLength(0);
  });

  test('the leafPreconfigId override applies to every subtask', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [
        { task_id: 'a', result: 'r:first' },
        { task_id: 'b', result: 'r:second' },
      ],
      synthesizerCalls: 0,
    };
    const deps = makeDeps(state, {
      orchestrator: {
        run: async () => ({ text: 'synth', json: null, sessionId: 'orch-1' }),
      },
    });

    await executeWorkflowWithDeps({
      prompt: 'analyze',
      leafPreconfigId: 'research',
      subtasks: [
        { prompt: 'first', preconfigId: 'explore' },
        { prompt: 'second', preconfigId: 'explore' },
      ],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore', 'research'],
    }, deps);

    expect(state.leaves.map((leaf) => leaf.subagent_type)).toEqual(['research', 'research']);
  });

  test('fan-out respects the hardcoded concurrency limit of five', async () => {
    let started = 0;
    let maxConcurrent = 0;
    let release: (() => void) | undefined;
    let fifthStarted: (() => void) | undefined;
    const fifth = new Promise<void>((resolve) => {
      fifthStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const state: FakeWorkflowState = { leaves: [], orchestratorCalls: [], leafResults: [], synthesizerCalls: 0 };
    const deps = makeDeps(state, {
      executeLeaf: async (input) => {
        state.leaves.push(input);
        started++;
        maxConcurrent = Math.max(maxConcurrent, started);
        if (started === 5) fifthStarted?.();
        await gate;
        started--;
        return { task_id: input.prompt, result: 'done' };
      },
    });

    const workflowPromise = executeWorkflowWithDeps({
      prompt: 'analyze',
      subtasks: Array.from({ length: 7 }, (_, index) => ({ prompt: `task-${index}`, preconfigId: 'explore' })),
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    await fifth;
    expect(started).toBe(5);
    expect(maxConcurrent).toBe(5);
    release?.();
    const result = await workflowPromise;
    expect(result.subtaskCount).toBe(7);
    expect(state.leaves).toHaveLength(7);
  });

  test('the default decomposition path runs through the injected orchestrator and reports decomposition failures', async () => {
    const state: FakeWorkflowState = {
      leaves: [],
      orchestratorCalls: [],
      leafResults: [{ task_id: 'a', result: 'r:first' }],
      synthesizerCalls: 0,
    };
    const deps = makeDeps(state, {
      orchestrator: {
        run: async (options) => {
          state.orchestratorCalls.push(options);
          return {
            text: '',
            json: { subtasks: [{ prompt: 'first', preconfigId: 'explore' }] },
            sessionId: 'orch-1',
          };
        },
      },
    });

    const result = await executeWorkflowWithDeps({ prompt: 'decompose me' }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, deps);

    expect(result.error).toBeUndefined();
    expect(result.subtaskCount).toBe(1);
    expect(state.orchestratorCalls).toHaveLength(2);
    expect(state.orchestratorCalls[0].agentName).toBe('decomposer');
    expect(state.orchestratorCalls[0].title).toBe('Decompose: decompose me');
    expect(state.orchestratorCalls[1].agentName).toBe('synthesizer');
    expect(state.leaves[0].prompt).toBe('first');

    const failingDeps = makeDeps(state, {
      orchestrator: {
        run: async () => {
          throw new Error('decomposer exploded');
        },
      },
    });
    const failed = await executeWorkflowWithDeps({ prompt: 'decompose me' }, {
      sessionId: 'root',
      allowedSubagentIds: ['explore'],
    }, failingDeps);
    expect(failed.error).toBe('Decomposition failed: decomposer exploded');
    expect(failed.subtaskCount).toBe(0);
  });
});

describe('C5 workflow decomposer and synthesizer behavior', () => {
  function decomposerDeps(records: Array<Parameters<OrchestratorSessionContract['run']>[0]>): DecomposeTaskDeps {
    return {
      listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
      orchestrator: {
        run: async (options) => {
          records.push(options);
          return {
            text: '',
            json: { subtasks: [{ prompt: 'probe', preconfigId: 'explore' }] },
            sessionId: 'orch-1',
          };
        },
      },
    };
  }

  test('the decomposer prompt pins the exact system content and caps the subtask list', async () => {
    const records: Array<Parameters<OrchestratorSessionContract['run']>[0]> = [];
    const subtasks = await decomposeTaskWithDeps({
      prompt: 'audit the repo',
      parentSessionId: 'root',
      allowedSubagentIds: ['explore', 'research'],
    }, decomposerDeps(records));

    expect(subtasks).toEqual([{ prompt: 'probe', preconfigId: 'explore' }]);
    expect(records).toHaveLength(1);
    const call = records[0];
    expect(call.agentName).toBe('decomposer');
    expect(call.title).toBe('Decompose: audit the repo');
    expect(call.maxTokens).toBe(4096);
    expect(call.userPrompt).toBe('audit the repo');
    expect(call.systemPrompt).toContain('You are a task decomposer. Given a high-level task, break it into independent');
    expect(call.systemPrompt).toContain('Available agent types:\n- explore: Research tasks\n- research: Deep research');
    expect(call.systemPrompt).toContain('- The preconfigId MUST be one of the listed agent types. Do NOT invent types.');
    expect(call.systemPrompt).toContain('{"subtasks":[{"prompt":"...","preconfigId":"..."}]}');
  });

  test('malformed, empty, and unavailable decompositions keep the exact errors', async () => {
    const malformedDeps: DecomposeTaskDeps = {
      listSubagents: async () => [EXPLORE_PRECONFIG],
      orchestrator: {
        run: async () => ({ text: 'not json', json: null, sessionId: 'orch-1' }),
      },
    };
    await expect(decomposeTaskWithDeps({ prompt: 'x', parentSessionId: 'root' }, malformedDeps))
      .rejects.toThrow('Decomposer failed to produce valid subtasks');

    const emptyDeps: DecomposeTaskDeps = {
      listSubagents: async () => [EXPLORE_PRECONFIG],
      orchestrator: {
        run: async () => ({ text: '', json: { subtasks: [] }, sessionId: 'orch-1' }),
      },
    };
    await expect(decomposeTaskWithDeps({ prompt: 'x', parentSessionId: 'root' }, emptyDeps))
      .rejects.toThrow('Decomposition produced no subtasks');

    const noneDeps: DecomposeTaskDeps = {
      listSubagents: async () => [],
      orchestrator: {
        run: async () => ({ text: '', json: { subtasks: [] }, sessionId: 'orch-1' }),
      },
    };
    await expect(decomposeTaskWithDeps({ prompt: 'x', parentSessionId: 'root' }, noneDeps))
      .rejects.toThrow('No subagent types available for this session');
  });

  test('sanitization falls back to the first available preconfig and applies the fifty-subtask cap', async () => {
    const inventedDeps: DecomposeTaskDeps = {
      listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
      orchestrator: {
        run: async () => ({
          text: '',
          json: { subtasks: [{ prompt: 'a', preconfigId: 'ghost' }] },
          sessionId: 'orch-1',
        }),
      },
    };
    const sanitized = await decomposeTaskWithDeps(
      { prompt: 'x', parentSessionId: 'root', allowedSubagentIds: ['explore', 'research'] },
      inventedDeps,
    );
    expect(sanitized).toEqual([{ prompt: 'a', preconfigId: 'explore' }]);

    const manyDeps: DecomposeTaskDeps = {
      listSubagents: async () => [EXPLORE_PRECONFIG],
      orchestrator: {
        run: async () => ({
          text: '',
          json: {
            subtasks: Array.from({ length: 55 }, (_, index) => ({ prompt: `t${index}`, preconfigId: 'explore' })),
          },
          sessionId: 'orch-1',
        }),
      },
    };
    const capped = await decomposeTaskWithDeps({ prompt: 'x', parentSessionId: 'root' }, manyDeps);
    expect(capped).toHaveLength(MAX_SUBTASKS);
  });

  test('the synthesizer pins the prompt, structured schema injection, and the json parse fallback', async () => {
    const calls: Array<Parameters<OrchestratorSessionContract['run']>[0]> = [];
    const deps = {
      orchestrator: {
        run: async (options: Parameters<OrchestratorSessionContract['run']>[0]) => {
          calls.push(options);
          return { text: '{"verdict":"ok"}', json: { verdict: 'ok' }, sessionId: 'orch-1' };
        },
      },
    };

    const structured = await synthesizeResultsWithDeps({
      originalPrompt: 'original task',
      leafResults: [
        { index: 0, text: 'one' },
        { index: 1, text: '', error: 'failed' },
      ],
      outputSchema: { type: 'object' },
      parentSessionId: 'root',
    }, deps);

    expect(structured).toEqual({ text: '{"verdict":"ok"}', structuredResult: { verdict: 'ok' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].agentName).toBe('synthesizer');
    expect(calls[0].title).toBe('Synthesize: original task');
    expect(calls[0].maxTokens).toBe(8192);
    expect(calls[0].systemPrompt).toContain('You are a synthesis agent. You have been given the results of several parallel');
    expect(calls[0].systemPrompt).toContain('Original task: original task');
    expect(calls[0].systemPrompt).toContain('Sub-agent 1 [success]:\n  Text: one');
    expect(calls[0].systemPrompt).toContain('Sub-agent 2 [FAILED]:\n  Error: failed');
    expect(calls[0].systemPrompt).toContain('You must respond with ONLY valid JSON that conforms to the following JSON Schema.');
    expect(calls[0].userPrompt).toBe('Synthesize the sub-agent results into a final answer. Respond with ONLY valid JSON conforming to the schema.');

    const rawDeps = {
      orchestrator: {
        run: async () => ({ text: 'raw text', json: null, sessionId: 'orch-1' }),
      },
    };
    const raw = await synthesizeResultsWithDeps({
      originalPrompt: 'original task',
      leafResults: [{ index: 0, text: 'one' }],
      outputSchema: { type: 'object' },
      parentSessionId: 'root',
    }, rawDeps);
    expect(raw).toEqual({ text: 'raw text' });
    expect(raw.structuredResult).toBeUndefined();
  });
});
