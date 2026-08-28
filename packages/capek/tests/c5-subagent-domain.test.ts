/**
 * C5 subagent domain slice characterization.
 *
 * Pins the domain plugin ownership after the subagent move: the composed
 * task tool contribution (id, order, plugin, depth gate, per-build dynamic
 * definition from scope-captured storage and preconfig sources with no
 * global fallback), the self-delegation context section ownership, the
 * unscoped fallback path with the exact pre-C5 build order, the ancestry
 * policy matrix, and the WithDeps execution lifecycle (child creation,
 * resume validation, status transitions, ordered result formatting,
 * structured output, abort handling) against injected fakes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig, Session, TextPart } from '@capekai/types';
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
  CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID,
  SELF_DELEGATION_SECTION_ID,
  SUBAGENT_TOOL_CONTRIBUTION_ID,
  SUBAGENT_TOOL_CONTRIBUTION_ORDER,
  capekSubagentDomainKey,
  installTaskToolFallback,
} from '../src/plugins/subagent-domain';
import {
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentTargetPreconfig,
} from '../src/subagent/policy';
import {
  executeSubagentWithDeps,
  type SubagentServiceDeps,
} from '../src/subagent/task-tool';
import { selfDelegationGuidance } from '../src/subagent/guidance';
import { configureStorage, createSession } from '../src/storage/runtime';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { clearCache } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

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
        tempDir: '/tmp/capek-c5-subagent-test',
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

const SELF_PRECONFIG = {
  id: 'agent-x',
  name: 'Agent X',
  description: 'Self-delegating agent',
  mode: 'both',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
  allowSelfAsSubagent: true,
} as Preconfig;

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource({
    get: async (id) => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
    getDefault: async () => null,
    getForAgent: async (id) => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
    list: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG],
    listSubagents: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
  });
  configureAgentSource();
  configureInstructionSource();
  configureWorkspaceToolDiscovery();
  installTaskToolFallback();
}

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  clearCache();
});

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-root',
    workspaceId: 'ws-1',
    preconfigId: null,
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

describe('C5 subagent composed scope ownership', () => {
  beforeEach(() => configureEnvironment());

  test('the composed current agent scope contributes the task tool with the pinned id, order, plugin, and payload', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = agentScope.listTools();
      const taskEntry = tools.find((entry) => entry.definition.name === 'task');
      expect(taskEntry).toBeDefined();
      expect(taskEntry!.id).toBe(SUBAGENT_TOOL_CONTRIBUTION_ID);
      expect(taskEntry!.order).toBe(SUBAGENT_TOOL_CONTRIBUTION_ORDER);
      expect(taskEntry!.pluginId).toBe(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID);
      expect(taskEntry!.visible).toBe(true);
      expect(taskEntry!.definition.timeout).toBeNull();
      expect(agentScope.require(capekSubagentDomainKey).tools.map((tool) => tool.name)).toEqual(['task']);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed current agent scope owns the self-delegation section with the exact guidance content', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const section = agentScope
        .listContextSections()
        .find((entry) => entry.id === SELF_DELEGATION_SECTION_ID);
      expect(section).toBeDefined();
      expect(section!.pluginId).toBe(CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID);
      expect(section!.phase).toBe('identity');
      expect(section!.order).toBe(50);

      const sections = await agentScope.buildContext({
        preconfig: SELF_PRECONFIG,
        workspacePath: undefined,
        workspaceId: undefined,
        additionalPaths: [],
        selfDelegationAvailable: true,
      });
      const selfDelegation = sections.find((entry) => entry.id === SELF_DELEGATION_SECTION_ID);
      expect(selfDelegation?.content).toBe(selfDelegationGuidance('agent-x'));

      const hidden = await agentScope.buildContext({
        preconfig: SELF_PRECONFIG,
        workspacePath: undefined,
        workspaceId: undefined,
        additionalPaths: [],
        selfDelegationAvailable: false,
      });
      expect(hidden.find((entry) => entry.id === SELF_DELEGATION_SECTION_ID)).toBeUndefined();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed task payload resolves the dynamic definition from the scope-captured sources and never falls back to globals', async () => {
    const scopePreconfigs = [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG];

    // Configure the scope values first so the composition binds them at
    // creation, exactly like a real agent scope.
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ preconfigId: 'agent-x' }));
    configurePreconfigSource({
      get: async (id) => scopePreconfigs.find((p) => p.id === id) ?? null,
      getDefault: async () => null,
      getForAgent: async (id) => scopePreconfigs.find((p) => p.id === id) ?? null,
      list: async () => scopePreconfigs,
      listSubagents: async () => scopePreconfigs,
    });

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      // Reconfigure the module-level globals AFTER composition with a
      // decoy subagent set; the composed build must reflect the scope's
      // captured sources and never read these globals.
      const decoyPreconfigs = [{ ...EXPLORE_PRECONFIG, id: 'global-only' }];
      configurePreconfigSource({
        get: async () => null,
        getDefault: async () => null,
        getForAgent: async () => null,
        list: async () => decoyPreconfigs,
        listSubagents: async () => decoyPreconfigs,
      });

      const built = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'sess-root',
        canSpawnSubagents: true,
      }));
      expect(Object.keys(built)).toEqual(['task', 'retrieve-tool-output']);
      const description = String((built.task as { description?: string })?.description ?? '');
      expect(description).toContain('- explore: Research tasks');
      expect(description).toContain('- research: Deep research');
      expect(description).not.toContain('global-only');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed payload depth gate blocks the task tool at maximum depth', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'root', preconfigId: 'agent-x' }));
    createSession(makeSession({ id: 'child-1', parentId: 'root', preconfigId: 'explore' }));
    createSession(makeSession({ id: 'child-2', parentId: 'child-1', preconfigId: 'explore' }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        const tools = await buildAiSdkTools({
          toolNames: [],
          workspacePath: undefined,
          workspaceId: undefined,
          sessionId: 'child-2',
          canSpawnSubagents: true,
        });
        expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
      });
      expect(await agentScope.require(capekSubagentDomainKey).canSpawnSubagent('child-2')).toBe(false);
      expect(await agentScope.require(capekSubagentDomainKey).canSpawnSubagent('root')).toBe(true);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the unscoped fallback path keeps the pre-C5 build order and the dynamic definition from module accessors', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const tools = await buildAiSdkTools({
      toolNames: ['ext'],
      workspacePath: undefined,
      workspaceId: undefined,
      sessionId: 'sess-root',
      canSpawnSubagents: true,
    });
    expect(Object.keys(tools)).toEqual(['task', 'retrieve-tool-output']);
    const description = String((tools.task as { description?: string })?.description ?? '');
    expect(description).toContain('- explore: Research tasks');
    expect(description).toContain('- research: Deep research');
  });

  test('the unscoped fallback omits the task tool when spawning is disabled', async () => {
    configureStorage(createInMemoryStorageBundle());
    createSession(makeSession({ id: 'sess-root' }));

    const tools = await buildAiSdkTools({
      toolNames: [],
      workspacePath: undefined,
      workspaceId: undefined,
      sessionId: 'sess-root',
      canSpawnSubagents: false,
    });
    expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
  });
});

describe('C5 subagent ancestry policy', () => {
  test('target evaluation covers self-disabled, allowed self, repeated ancestor, target-not-allowed, and depth', () => {
    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
    })).toEqual({ allowed: true, reason: 'allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
    })).toMatchObject({ allowed: false, reason: 'self_disabled' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: true,
    })).toEqual({ allowed: true, reason: 'allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'agent-x',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x', 'agent-x'],
      allowSelfAsSubagent: true,
    })).toMatchObject({ allowed: false, reason: 'repeated_ancestor' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x', 'explore'],
      allowSelfAsSubagent: false,
    })).toMatchObject({ allowed: false, reason: 'repeated_ancestor' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
      allowedSubagentIds: ['research'],
    })).toMatchObject({ allowed: false, reason: 'target_not_allowed' });

    expect(evaluateSubagentTarget({
      targetPreconfigId: 'explore',
      currentPreconfigId: 'agent-x',
      ancestryPreconfigIds: ['agent-x'],
      allowSelfAsSubagent: false,
      maximumDepthReached: true,
    })).toMatchObject({ allowed: false, reason: 'maximum_depth' });
  });

  test('spawn-disabled and target-preconfig classification rules', () => {
    expect(isSubagentSpawningDisabled(false)).toBe(true);
    expect(isSubagentSpawningDisabled(null)).toBe(true);
    expect(isSubagentSpawningDisabled([])).toBe(true);
    expect(isSubagentSpawningDisabled(['explore'])).toBe(false);
    expect(isSubagentSpawningDisabled(true)).toBe(false);
    expect(isSubagentSpawningDisabled(undefined)).toBe(false);

    expect(isValidSubagentTargetPreconfig(EXPLORE_PRECONFIG, 'agent-x', false)).toBe(true);
    expect(isValidSubagentTargetPreconfig({ id: 'agent-x', mode: 'primary' }, 'agent-x', true)).toBe(true);
    expect(isValidSubagentTargetPreconfig({ id: 'agent-x', mode: 'primary' }, 'agent-x', false)).toBe(false);
  });

  test('resume validation rejects forged task ids from other sessions and preconfig types', () => {
    expect(getSubagentResumeError(
      { parentId: 'other', preconfigId: 'explore' },
      'sess-root',
      'explore',
    )).toBe('Invalid task_id: does not belong to this session');

    expect(getSubagentResumeError(
      { parentId: 'sess-root', preconfigId: 'research' },
      'sess-root',
      'explore',
    )).toBe('Invalid task_id: belongs to subagent type "research", not "explore"');

    expect(getSubagentResumeError(
      { parentId: 'sess-root', preconfigId: 'explore' },
      'sess-root',
      'explore',
    )).toBeNull();
  });
});

describe('C5 subagent execution with injected deps', () => {
  function makeState() {
    const state = {
      sessions: new Map<string, Session>(),
      updates: [] as Array<{ id: string; updates: Record<string, unknown> }>,
      events: [] as unknown[],
      children: [] as Array<Parameters<NonNullable<SubagentServiceDeps['executeChild']>>[0]>,
    };

    const sessionAccess: SubagentServiceDeps['sessionAccess'] = {
      getSession: (id) => state.sessions.get(id) ?? null,
      createSession: (session) => {
        const created = { ...session, createdAt: '', updatedAt: '' } as Session;
        state.sessions.set(created.id, created);
        return created;
      },
      updateSession: (id, updates) => {
        state.updates.push({ id, updates: { ...updates } });
        const existing = state.sessions.get(id);
        if (!existing) return null;
        const updated = { ...existing, ...updates };
        state.sessions.set(updated.id, updated);
        return updated;
      },
      getWorkspaceAutoApproveSeverity: async () => 'low',
    };

    const deps: SubagentServiceDeps = {
      sessionAccess,
      preconfigs: {
        getPreconfigOrAgent: async (id) =>
          [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG, SELF_PRECONFIG].find((p) => p.id === id) ?? null,
        listSubagentPreconfigs: async () => [EXPLORE_PRECONFIG, RESEARCH_PRECONFIG],
      },
      broadcasts: {
        event: (event) => state.events.push(event),
        sessionCreated: (session) => state.events.push({ created: session.id }),
        sessionUpdated: (session) => state.events.push({ updated: session.id }),
        toSession: (sessionId, event) => state.events.push({ to: sessionId, event }),
      },
      executeChild: async (options) => {
        state.children.push(options);
        return {
          parts: [
            { id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'final-answer' } as TextPart,
          ],
          error: options.childSessionId === 'failing-child' ? 'child exploded' : undefined,
          ...(options.responseFormat ? { structuredOutput: { data: { verdict: 'ok' } } } : {}),
        };
      },
    };

    return { state, deps };
  }

  function baseInput(overrides: Record<string, unknown> = {}): Parameters<typeof executeSubagentWithDeps>[0] {
    return {
      description: 'Probe the repo',
      prompt: 'Investigate the layout',
      subagent_type: 'explore',
      sessionId: 'sess-root',
      workspaceId: 'ws-1',
      ...overrides,
    } as Parameters<typeof executeSubagentWithDeps>[0];
  }

  test('creates the child session with the exact parent-child fields and ordered result formatting', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const result = await executeSubagentWithDeps(baseInput(), deps);

    const child = state.sessions.get(result.task_id)!;
    expect(child.parentId).toBe('sess-root');
    expect(child.preconfigId).toBe('explore');
    expect(child.title).toBe('Probe the repo (@explore subagent)');
    expect(child.agentName).toBe('explore');
    expect(child.subagentStatus).toBe('completed');
    expect(child.metadata).toBeNull();
    expect(child.workspaceId).toBe('ws-1');
    expect(child.autoApproveSeverity).toBe('low');
    expect(state.children[0]).toMatchObject({
      parentSessionId: 'sess-root',
      childSessionId: result.task_id,
      prompt: 'Investigate the layout',
      resumeFromHistory: false,
    });
    expect(result.result).toBe(
      `task_id: ${result.task_id} (for resuming to continue this task if needed)\n\n<task_result>\nfinal-answer\n</task_result>\n`,
    );
    expect(result.error).toBeUndefined();
    expect(state.events.some((event) => (event as { created?: string }).created === result.task_id)).toBe(true);
    expect(state.events.some((event) => (event as { updated?: string }).updated === result.task_id)).toBe(true);
  });

  test('marks the child errored on execution error and returns the error directly without text', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const result = await executeSubagentWithDeps(baseInput({ subagent_type: 'explore' }), {
      ...deps,
      executeChild: async () => ({ parts: [], error: 'child exploded' }),
    });

    expect(result.result).toBe('');
    expect(result.error).toBe('child exploded');
    const child = state.sessions.get(result.task_id)!;
    expect(child.subagentStatus).toBe('error');
  });

  test('captures structured output when an output schema is provided', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const result = await executeSubagentWithDeps(
      baseInput({ outputSchema: { type: 'object' } }),
      deps,
    );

    expect(result.structuredResult).toEqual({ verdict: 'ok' });
    expect(result.result).toContain('<structured_result>');
    expect(result.result).toContain('"verdict": "ok"');
  });

  test('resumes an existing child session and rejects forged task ids', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    state.sessions.set(
      'existing-child',
      makeSession({ id: 'existing-child', parentId: 'sess-root', preconfigId: 'explore', subagentStatus: 'completed' }),
    );

    const resumed = await executeSubagentWithDeps(baseInput({ task_id: 'existing-child' }), deps);
    expect(resumed.task_id).toBe('existing-child');
    expect(state.children[0]).toMatchObject({ childSessionId: 'existing-child', resumeFromHistory: true });
    expect(state.updates.some((entry) =>
      entry.id === 'existing-child' && entry.updates.subagentStatus === 'running')).toBe(true);

    const forged = await executeSubagentWithDeps(baseInput({ task_id: 'stranger' }), deps);
    // task_id: 'stranger' does not exist -> childSession = null -> creates a fresh child.
    expect(forged.error).toBeUndefined();

    state.sessions.set(
      'other-session-child',
      makeSession({ id: 'other-session-child', parentId: 'other-root', preconfigId: 'explore' }),
    );
    const wrongParent = await executeSubagentWithDeps(baseInput({ task_id: 'other-session-child' }), deps);
    expect(wrongParent.error).toBe('Invalid task_id: does not belong to this session');

    state.sessions.set(
      'wrong-type-child',
      makeSession({ id: 'wrong-type-child', parentId: 'sess-root', preconfigId: 'research' }),
    );
    const wrongType = await executeSubagentWithDeps(baseInput({ task_id: 'wrong-type-child' }), deps);
    expect(wrongType.error).toBe('Invalid task_id: belongs to subagent type "research", not "explore"');
  });

  test('blocks unknown, disallowed, and non-subagent targets with the exact messages', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const unknown = await executeSubagentWithDeps(baseInput({ subagent_type: 'ghost' }), deps);
    expect(unknown.error).toBe('Unknown subagent type: "ghost". Available subagents: explore, research');

    const disallowed = await executeSubagentWithDeps(baseInput({ subagent_type: 'research', allowedSubagentIds: ['explore'] }), deps);
    expect(disallowed.error).toBe('Subagent type "research" is not allowed for this agent. Allowed types: explore, agent-x');
  });

  test('blocks self-delegation without allowSelfAsSubagent and repeated ancestry', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    deps.preconfigs.getPreconfigOrAgent = async (id) =>
      (id === 'agent-x' ? { ...SELF_PRECONFIG, allowSelfAsSubagent: false } : null);

    const selfDenied = await executeSubagentWithDeps(baseInput({ subagent_type: 'agent-x' }), deps);
    expect(selfDenied.error).toBe('Preconfig "agent-x" is not allowed to use itself as a subagent.');

    state.sessions.set('child-1', makeSession({ id: 'child-1', parentId: 'sess-root', preconfigId: 'agent-x' }));
    deps.preconfigs.getPreconfigOrAgent = async (id) =>
      (id === 'agent-x' ? { ...SELF_PRECONFIG, allowSelfAsSubagent: true } : null);
    const repeated = await executeSubagentWithDeps(
      baseInput({ sessionId: 'child-1', subagent_type: 'agent-x' }),
      deps,
    );
    expect(repeated.error).toBe('Preconfig "agent-x" is already present in this subagent chain.');
  });

  test('blocks at maximum depth and on disabled spawning', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));
    state.sessions.set('c1', makeSession({ id: 'c1', parentId: 'sess-root', preconfigId: 'explore' }));
    state.sessions.set('c2', makeSession({ id: 'c2', parentId: 'c1', preconfigId: 'explore' }));

    const depth = await executeSubagentWithDeps(baseInput({ sessionId: 'c2' }), deps);
    expect(depth.error).toBe('Maximum subagent depth (2) reached. Cannot spawn more subagents.');

    deps.preconfigs.getPreconfigOrAgent = async () => ({ ...SELF_PRECONFIG, canSpawnSubagents: false });
    const disabled = await executeSubagentWithDeps(
      baseInput({ subagent_type: 'agent-x' }),
      deps,
    );
    expect(disabled.error).toBe('Subagent spawning is disabled for this agent.');
  });

  test('handles abort before start and the interrupted transition when aborted during execution', async () => {
    const { state, deps } = makeState();
    state.sessions.set('sess-root', makeSession({ id: 'sess-root', preconfigId: 'agent-x' }));

    const preAborted = new AbortController();
    preAborted.abort();
    const before = await executeSubagentWithDeps(baseInput({ abortSignal: preAborted.signal }), deps);
    expect(before.error).toBe('Subagent execution aborted before start');

    // Abort during execution: the abort handler is registered before the
    // child run starts, so aborting inside executeChild marks the run
    // interrupted exactly like the pre-C5 path.
    const controller = new AbortController();
    const during = await executeSubagentWithDeps(
      baseInput({ abortSignal: controller.signal }),
      {
        ...deps,
        executeChild: async (options) => {
          state.children.push(options);
          controller.abort();
          return {
            parts: [{ id: 'p1', messageId: 'm1', createdAt: 0, type: 'text', text: 'late-answer' } as TextPart],
          };
        },
      },
    );
    expect(during.error).toBe('Subagent execution was interrupted');
    expect(during.result).toBe('');
    expect(state.updates.some((entry) =>
      entry.id === during.task_id && entry.updates.subagentStatus === 'interrupted')).toBe(true);
  });
});
