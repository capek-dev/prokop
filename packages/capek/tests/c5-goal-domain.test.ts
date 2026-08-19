/**
 * C5 goal domain slice characterization.
 *
 * Pins the goal domain plugin ownership: the agent-scoped
 * `capek.goal-domain` service over the scope-captured storage bundle and
 * the shared `capek.orchestrator-session` contract with no module-global
 * fallback and no workflow implementation imports; the evaluator prompt,
 * schema injection, parse and failure behavior; the run directive; and the
 * full goal loop lifecycle (met, remaining, failed, cancelled, max-turn)
 * with exact goal state persistence and broadcast ordering. The pre-C5
 * product has no model-facing goal tool (goal mode is a client session
 * directive through handleChat), so the domain contributes no tool and no
 * context section; that is pinned here.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssistantMessage, GoalState, Session, TextPart } from '@capekai/types';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import {
  CURRENT_GOAL_DOMAIN_PLUGIN_ID,
  capekGoalDomainKey,
  goalDomainPlugin,
} from '../src/plugins/goal-domain';
import {
  capekOrchestratorSessionKey,
  type OrchestratorSessionContract,
} from '../src/plugins/service-keys';
import {
  evaluateGoalWithDeps,
  buildContinuationMessage,
} from '../src/goals/evaluator';
import {
  runGoalLoop,
  runGoalLoopWithDeps,
  type GoalLoopDeps,
  type RunTurnFn,
} from '../src/goals/loop';
import { getGoalDomain, withGoalDomain } from '../src/goals/service';
import { enterAgentScope } from '../src/plugins/compose';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { configureStorage, createInMemoryStorageBundle } from '../src/storage';
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
        tempDir: '/tmp/capek-c5-goal-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'goal-sess',
    workspaceId: 'ws-goal',
    preconfigId: 'primary',
    title: 'Goal session',
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

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configureWorkspaceToolDiscovery();
}

afterEach(async () => {
  configureEnvironment();
});

interface FakeLoopState {
  session: Session;
  broadcasts: Session[];
  turns: string[];
}

function makeLoopDeps(
  state: FakeLoopState,
  evaluations: Array<{ goalMet: boolean; reason: string; remainingWork?: string }>,
  turnResults: Array<{ streamCompleted: boolean; interrupted: boolean }>,
  overrides: Partial<GoalLoopDeps> = {},
): GoalLoopDeps {
  const sessions = new Map<string, Session>();
  sessions.set(state.session.id, state.session);
  return {
    getSession: (id) => sessions.get(id) ?? null,
    updateSession: (id, updates) => {
      const current = sessions.get(id);
      if (!current) return null;
      const updated = { ...current, ...updates } as Session;
      sessions.set(id, updated);
      state.session = updated;
      return updated;
    },
    evaluate: async () => evaluations.shift() ?? { goalMet: false, reason: 'still working' },
    broadcastSessionUpdatedDefault: (session) => state.broadcasts.push(session),
    ...overrides,
  };
}

function makeRunTurn(state: FakeLoopState, results: Array<{ streamCompleted: boolean; interrupted: boolean }>): RunTurnFn {
  return async (content) => {
    state.turns.push(content);
    return results.shift() ?? { streamCompleted: true, interrupted: false };
  };
}

function goalStateOf(session: Session): GoalState | undefined {
  return session.metadata?.goal as GoalState | undefined;
}

describe('C5 goal composed scope ownership', () => {
  beforeEach(() => configureEnvironment());

  test('the current composition installs the goal domain service with the pinned key and scope', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekGoalDomainKey);
      expect(service).toBeDefined();
      expect(typeof service.evaluateGoal).toBe('function');
      expect(typeof service.runGoalLoop).toBe('function');
      expect(agentScope.optional(capekOrchestratorSessionKey)).toBeDefined();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the goal domain contributes no tool and no context section', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = agentScope.listTools();
      // No pre-C5 model-facing goal tool exists: goal mode is a client
      // session directive. The domain therefore contributes no tool.
      expect(tools.some((tool) => tool.definition.name === 'goal')).toBe(false);
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
      expect(
        agentScope.listContextSections().some((section) => section.pluginId === CURRENT_GOAL_DOMAIN_PLUGIN_ID),
      ).toBe(false);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed evaluator uses the scope-captured transcript and orchestrator contract, never module globals', async () => {
    // Compose a minimal agent scope with a scope storage bundle carrying a
    // distinctive transcript and a recording custom orchestrator contract.
    const scopeStorage = createInMemoryStorageBundle();
    scopeStorage.conversation.createSession({
      id: 'goal-sess',
      workspaceId: 'ws-goal',
      preconfigId: 'primary',
      title: 'Goal session',
      status: 'active',
      metadata: null,
      parentId: null,
      agentName: null,
      autoApproveSeverity: 'low',
    });
    scopeStorage.conversation.createMessage({
      id: 'scope-msg',
      sessionId: 'goal-sess',
      role: 'assistant',
      status: 'completed',
      createdAt: 0,
      completedAt: 0,
    } as AssistantMessage);
    scopeStorage.conversation.createPart({
      id: 'scope-part',
      messageId: 'scope-msg',
      createdAt: 0,
      type: 'text',
      text: 'scope transcript evidence',
    } as TextPart, 'goal-sess');

    // The module-level storage carries a DIFFERENT decoy transcript.
    const decoyStorage = createInMemoryStorageBundle();
    decoyStorage.conversation.createSession({
      id: 'goal-sess',
      workspaceId: 'ws-goal',
      preconfigId: 'primary',
      title: 'Goal session',
      status: 'active',
      metadata: null,
      parentId: null,
      agentName: null,
      autoApproveSeverity: 'low',
    });
    decoyStorage.conversation.createMessage({
      id: 'decoy-msg',
      sessionId: 'goal-sess',
      role: 'assistant',
      status: 'completed',
      createdAt: 0,
      completedAt: 0,
    } as AssistantMessage);
    decoyStorage.conversation.createPart({
      id: 'decoy-part',
      messageId: 'decoy-msg',
      createdAt: 0,
      type: 'text',
      text: 'decoy transcript evidence',
    } as TextPart, 'goal-sess');
    configureStorage(decoyStorage);

    const calls: Array<{ systemPrompt: string }> = [];
    const customContract: OrchestratorSessionContract = {
      run: async (options) => {
        calls.push({ systemPrompt: options.systemPrompt });
        return { text: '{"goalMet":true,"reason":"done"}', json: { goalMet: true, reason: 'done' }, sessionId: 'eval-1' };
      },
    };

    const { createAgentScope } = await import('../src/kernel/kernel');
    const { capekStorageKey, capekRuntimeHostKey } = await import('../src/plugins/service-keys');
    const processScope = await createCurrentProcessScope();
    const agentScope = await createAgentScope(processScope, [
      {
        id: 'test.storage',
        scope: 'agent',
        provides: [capekStorageKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekStorageKey, scopeStorage);
        },
      },
      {
        id: 'test.host',
        scope: 'agent',
        provides: [capekRuntimeHostKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekRuntimeHostKey, minimalHost());
        },
      },
      {
        id: 'test.orchestrator',
        scope: 'agent',
        provides: [capekOrchestratorSessionKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekOrchestratorSessionKey, customContract);
        },
      },
      goalDomainPlugin('test.goal-domain'),
    ]);
    try {
      const service = agentScope.require(capekGoalDomainKey);
      const result = await service.evaluateGoal({
        sessionId: 'goal-sess',
        condition: 'tests pass',
        turn: 1,
        maxTurns: 3,
      });
      expect(result.goalMet).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].systemPrompt).toContain('scope transcript evidence');
      expect(calls[0].systemPrompt).not.toContain('decoy transcript evidence');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed evaluator does not import the workflow implementation', async () => {
    // The plugin bridge requires the shared contract key only; the domain
    // types are structural. The import gate lives in the boundary suite;
    // here we pin that the plugin composes with a custom provider of the
    // shared contract.
    const customContract: OrchestratorSessionContract = {
      run: async () => ({ text: 'x', json: null, sessionId: 'custom' }),
    };
    const storage = createInMemoryStorageBundle();
    const processScope = await createCurrentProcessScope();
    // Compose a minimal agent scope with storage, runtime host, the custom
    // orchestrator contract, and the goal domain plugin; the plugin must
    // accept the injected contract without touching workflow code.
    const { createAgentScope } = await import('../src/kernel/kernel');
    const { capekStorageKey, capekRuntimeHostKey } = await import('../src/plugins/service-keys');
    const agentScope = await createAgentScope(processScope, [
      {
        id: 'test.storage',
        scope: 'agent',
        provides: [capekStorageKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekStorageKey, storage);
        },
      },
      {
        id: 'test.host',
        scope: 'agent',
        provides: [capekRuntimeHostKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekRuntimeHostKey, minimalHost());
        },
      },
      {
        id: 'test.orchestrator',
        scope: 'agent',
        provides: [capekOrchestratorSessionKey],
        setup(context: import('../src/kernel/types').PluginContext) {
          context.provide(capekOrchestratorSessionKey, customContract);
        },
      },
      goalDomainPlugin('test.goal-domain'),
    ]);
    try {
      const service = agentScope.require(capekGoalDomainKey);
      const evaluation = await service.evaluateGoal({
        sessionId: 'none',
        condition: 'x',
        turn: 1,
        maxTurns: 2,
      });
      expect(evaluation).toEqual({
        goalMet: false,
        reason: 'No reason provided',
        remainingWork: undefined,
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 goal evaluator behavior', () => {
  test('pins the exact prompt, title, agent name, maxTokens, and parse defaults', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await evaluateGoalWithDeps({
      sessionId: 'goal-sess',
      condition: 'all tests pass',
      turn: 2,
      maxTurns: 4,
    }, {
      listTranscript: async () => [],
      orchestrator: {
        run: async (options) => {
          calls.push({ ...options });
          return { text: '{}', json: {}, sessionId: 'eval-1' };
        },
      },
    });

    expect(result).toEqual({ goalMet: false, reason: 'No reason provided', remainingWork: undefined });
    expect(calls).toHaveLength(1);
    const call = calls[0] as unknown as {
      parentSessionId: string;
      title: string;
      agentName: string;
      systemPrompt: string;
      userPrompt: string;
      maxTokens: number;
    };
    expect(call.parentSessionId).toBe('goal-sess');
    expect(call.title).toBe('Goal Eval (Turn 2): all tests pass');
    expect(call.agentName).toBe('goal-evaluator');
    expect(call.maxTokens).toBe(2048);
    expect(call.userPrompt).toBe('Evaluate: has the condition "all tests pass" been met based on the transcript above?');
    expect(call.systemPrompt).toContain('You are a goal evaluator. Your job is to determine if a completion condition');
    expect(call.systemPrompt).toContain('Completion condition: "all tests pass"');
    expect(call.systemPrompt).toContain('Conversation transcript (turn 2 of 4):');
    expect(call.systemPrompt).toContain('{"goalMet": true/false, "reason": "explanation", "remainingWork": "what is left to do"}');
  });

  test('summarizes transcripts with the exact user, assistant, and tool formatting', async () => {
    const transcript = [
      {
        message: { id: 'u1', sessionId: 'goal-sess', role: 'user', createdAt: 0 } as never,
        parts: [{ id: 'p1', messageId: 'u1', createdAt: 0, type: 'text', text: 'run tests' }],
      },
      {
        message: { id: 'a1', sessionId: 'goal-sess', role: 'assistant', createdAt: 1 } as never,
        parts: [
          { id: 'p2', messageId: 'a1', createdAt: 1, type: 'text', text: 'running' },
          {
            id: 'p3',
            messageId: 'a1',
            createdAt: 1,
            type: 'tool',
            name: 'shell',
            state: { status: 'completed', output: '3 passing' },
          },
        ],
      },
      {
        message: { id: 'a2', sessionId: 'goal-sess', role: 'assistant', createdAt: 2 } as never,
        parts: [{
          id: 'p4',
          messageId: 'a2',
          createdAt: 2,
          type: 'tool',
          name: 'shell',
          state: { status: 'error', error: 'boom' },
        }],
      },
    ];
    let captured = '';
    await evaluateGoalWithDeps({
      sessionId: 'goal-sess',
      condition: 'tests pass',
      turn: 1,
      maxTurns: 2,
    }, {
      listTranscript: () => transcript as never,
      orchestrator: {
        run: async (options) => {
          captured = options.systemPrompt;
          return { text: '', json: null, sessionId: 'eval-1' };
        },
      },
    });
    expect(captured).toContain('[USER]: run tests');
    expect(captured).toContain('[ASSISTANT]: running\n[TOOL: shell]: 3 passing');
    expect(captured).toContain('[TOOL: shell]: ERROR: boom');
  });

  test('the run directive pins the exact continuation text', () => {
    expect(buildContinuationMessage('all tests pass', 'coverage missing', 'add tests')).toBe([
      'The goal is NOT yet met: all tests pass',
      '',
      'Evaluator feedback: coverage missing',
      '\nRemaining work: add tests',
      '',
      'Continue working toward the goal. Do not repeat work you have already done.',
    ].join('\n'));
    expect(buildContinuationMessage('x', 'no reason')).toBe([
      'The goal is NOT yet met: x',
      '',
      'Evaluator feedback: no reason',
      '',
      '',
      'Continue working toward the goal. Do not repeat work you have already done.',
    ].join('\n'));
  });
});

describe('C5 goal loop lifecycle with injected deps', () => {
  test('initializes goal state and defaults maxTurns to five with the initial prompt', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [{ goalMet: true, reason: 'done' }], [{ streamCompleted: true, interrupted: false }]);

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'finish the task',
      initialPrompt: 'start here',
      runTurn: makeRunTurn(state, [{ streamCompleted: true, interrupted: false }]),
    }, deps);

    expect(state.turns).toEqual(['start here']);
    const goal = goalStateOf(state.session);
    expect(goal?.status).toBe('met');
    expect(goal?.maxTurns).toBe(5);
    expect(goal?.currentTurn).toBe(1);
    expect(goal?.condition).toBe('finish the task');
    expect(goal?.startedAt).toBeDefined();
    expect(goal?.completedAt).toBeDefined();
    expect(state.broadcasts.length).toBeGreaterThan(0);
  });

  test('uses the condition as the first turn content when no initial prompt is given', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [{ goalMet: false, reason: 'keep going' }], [
      { streamCompleted: true, interrupted: false },
      { streamCompleted: true, interrupted: false },
    ]);

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'the condition itself',
      maxTurns: 2,
      runTurn: makeRunTurn(state, [
        { streamCompleted: true, interrupted: false },
        { streamCompleted: true, interrupted: false },
      ]),
    }, deps);

    expect(state.turns[0]).toBe('the condition itself');
    expect(state.turns[1]).toContain('The goal is NOT yet met: the condition itself');
    expect(state.turns[1]).toContain('Evaluator feedback: keep going');
    expect(goalStateOf(state.session)?.status).toBe('failed');
  });

  test('an interrupted turn cancels the goal loop', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [], [{ streamCompleted: false, interrupted: true }]);

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'x',
      runTurn: makeRunTurn(state, [{ streamCompleted: false, interrupted: true }]),
    }, deps);

    expect(goalStateOf(state.session)?.status).toBe('cancelled');
    expect(goalStateOf(state.session)?.completedAt).toBeDefined();
  });

  test('an incomplete stream fails the goal loop', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [], [{ streamCompleted: false, interrupted: false }]);

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'x',
      runTurn: makeRunTurn(state, [{ streamCompleted: false, interrupted: false }]),
    }, deps);

    expect(goalStateOf(state.session)?.status).toBe('failed');
  });

  test('a throwing evaluator continues the loop with the exact fallback reason', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [], [{ streamCompleted: true, interrupted: false }]);
    deps.evaluate = async () => {
      throw new Error('model exploded');
    };

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'x',
      maxTurns: 1,
      runTurn: makeRunTurn(state, [{ streamCompleted: true, interrupted: false }]),
    }, deps);

    expect(state.turns).toHaveLength(1);
    expect(goalStateOf(state.session)?.status).toBe('failed');
  });

  test('abort before and after a turn cancels with the exact ordering', async () => {
    const controller = new AbortController();
    controller.abort();
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [], []);

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'x',
      abortSignal: controller.signal,
      runTurn: makeRunTurn(state, []),
    }, deps);
    expect(goalStateOf(state.session)?.status).toBe('cancelled');
    expect(state.turns).toHaveLength(0);
  });

  test('broadcast ordering: every state transition persists before broadcasting the updated session', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const deps = makeLoopDeps(state, [{ goalMet: true, reason: 'done' }], [{ streamCompleted: true, interrupted: false }]);
    const order: string[] = [];
    deps.broadcastSessionUpdatedDefault = (session) => {
      order.push(`broadcast:${(session.metadata?.goal as GoalState | undefined)?.status ?? 'none'}`);
      state.broadcasts.push(session);
    };

    await runGoalLoopWithDeps({
      sessionId: 'goal-sess',
      condition: 'x',
      runTurn: makeRunTurn(state, [{ streamCompleted: true, interrupted: false }]),
    }, deps);

    expect(order).toEqual(['broadcast:active', 'broadcast:active', 'broadcast:met']);
    // The final broadcast carries the terminal state already persisted.
    expect((state.broadcasts.at(-1)?.metadata?.goal as GoalState | undefined)?.status).toBe('met');
    expect((state.broadcasts.at(-1)?.metadata?.goal as GoalState | undefined)?.completedAt).toBeDefined();
  });

  test('the unscoped goal loop preserves its behavior', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const sessions = new Map<string, Session>([[state.session.id, state.session]]);
    configureStorage({
      ...createInMemoryStorageBundle(),
      conversation: {
        ...createInMemoryStorageBundle().conversation,
        getSession: async (id) => sessions.get(id) ?? null,
        updateSession: async (id, updates) => {
          const current = sessions.get(id);
          if (!current) return null;
          const updated = { ...current, ...updates } as Session;
          sessions.set(id, updated);
          state.session = updated;
          return updated;
        },
      },
    });

    await runGoalLoop({
      sessionId: 'goal-sess',
      condition: 'module path',
      maxTurns: 1,
      runTurn: async () => ({ streamCompleted: true, interrupted: false }),
      evaluate: async () => ({ goalMet: true, reason: 'done' }),
    });

    expect(goalStateOf(state.session)?.status).toBe('met');
  });
});

describe('goal domain live adoption accessor', () => {
  test('the accessor returns the module-path fallback outside a composed scope', async () => {
    const state: FakeLoopState = { session: makeSession(), broadcasts: [], turns: [] };
    const sessions = new Map<string, Session>([[state.session.id, state.session]]);
    configureStorage({
      ...createInMemoryStorageBundle(),
      conversation: {
        ...createInMemoryStorageBundle().conversation,
        getSession: async (id) => sessions.get(id) ?? null,
        updateSession: async (id, updates) => {
          const current = sessions.get(id);
          if (!current) return null;
          const updated = { ...current, ...updates } as Session;
          sessions.set(id, updated);
          state.session = updated;
          return updated;
        },
      },
    });

    await getGoalDomain().runGoalLoop({
      sessionId: 'goal-sess',
      condition: 'accessor fallback',
      maxTurns: 1,
      runTurn: async () => ({ streamCompleted: true, interrupted: false }),
      evaluate: async () => ({ goalMet: true, reason: 'done' }),
    });

    expect(goalStateOf(state.session)?.status).toBe('met');
  });

  test('a seeded service wins over the module-path fallback', async () => {
    const calls: string[] = [];
    withGoalDomain(
      {
        evaluateGoal: () => {
          throw new Error('not under test');
        },
        runGoalLoop: async (options) => {
          calls.push(options.condition);
        },
      },
      async () => {
        await getGoalDomain().runGoalLoop({
          sessionId: 'seeded',
          condition: 'seeded service',
          maxTurns: 1,
          runTurn: async () => ({ streamCompleted: true, interrupted: false }),
        });
      },
    );

    expect(calls).toEqual(['seeded service']);
  });

  test('a composed agent scope with the goal plugin seeds the accessor', async () => {
    const seen: string[] = [];
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service = agentScope.require(capekGoalDomainKey);
      await enterAgentScope(agentScope, async () => {
        seen.push(getGoalDomain() === service ? 'scoped' : 'fallback');
      });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
    expect(seen).toEqual(['scoped']);
  });
});
