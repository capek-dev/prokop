import { describe, expect, test } from 'bun:test';
import type { LanguageModel } from 'ai';
import type {
  AssistantMessage, GoalState, Message, MessageWithParts, Part, Preconfig, Session } from '@capekai/types';
import { SandboxLanguageModel } from '../src/sandbox/model';
import { sandboxController } from '../src/sandbox/controller';
import {
  configureAgentSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { registerProvider, resetProviders } from '../src/providers/registry';
import { executeChildSession } from '../src/subagent/child-session';
import { canSpawnSubagent, executeSubagent } from '../src/subagent/task-tool';
import { getSubagentResumeError } from '../src/subagent/policy';
import { createLlmApi } from '../src/tools/llm-api';
import { evaluateGoal } from '../src/goals/evaluator';
import { runGoalLoop } from '../src/goals/loop';
import { executeWorkflow } from '../src/workflow/execution';
import {
  handleChat,
  regenerateSessionTitle,
} from '../src/core/chat-handler';
import { runOrchestratorSession } from '../src/workflow/orchestrator-session';
import { decomposeTask } from '../src/workflow/decomposer';
import { synthesizeResults } from '../src/workflow/synthesizer';
import {
  configureRuntimeHost,
  type RuntimeHost,
} from '../src/runtime/host';
import { setDefaultContextAssembler } from '../src/context/assembler';
import { fixedBuilderContextAssembler } from '../src/plugins/legacy-system-message';
import { installMemoryToolFallback } from '../src/plugins/memory-domain';
import { installSchedulerToolFallback } from '../src/plugins/scheduler-domain';
import { installSessionSearchToolFallback } from '../src/plugins/session-search-domain';
import { installSkillsToolFallback } from '../src/plugins/skills-domain';
import { installTaskToolFallback } from '../src/plugins/subagent-domain';
import { installWorkflowToolFallback } from '../src/plugins/workflow-domain';
import type { StreamChatEvent } from '../src/retry/stream-chat';
import type { RuntimeDelivery, RuntimeEvent } from '../src/runtime/events';
import type { ChatOptions } from '../src/core/agent';
import {
  configureStorage,
  createInMemoryStorageBundle,
  type StorageBundle,
} from '../src/storage';

const preconfig: Preconfig = {
  id: 'research',
  name: 'Research',
  description: 'Research tasks',
  systemPrompt: 'Research carefully',
  tools: [],
  model: null,
  provider: null,
  settings: null,
  isDefault: false,
  mode: 'subagent',
};

function session(id: string, parentId: string | null = null): Session {
  return {
    id,
    workspaceId: 'workspace-1',
    preconfigId: parentId ? 'research' : 'primary',
    title: 'Session',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    metadata: null,
    parentId,
  } as Session;
}

interface RuntimeState {
  sessions: Map<string, Session>;
  messages: Message[];
  parts: Part[];
  askTargets: RuntimeEvent[];
  controllerEvents: RuntimeEvent[];
  terminalMessages: AssistantMessage[];
}

interface RuntimeOverrides extends Omit<Partial<RuntimeHost>, 'delivery'> {
  storage?: Omit<Partial<StorageBundle>, 'conversation'> & {
    conversation?: Partial<StorageBundle['conversation']>;
  };
  delivery?: Partial<RuntimeHost['delivery']>;
}

function bindRuntime(
  state: RuntimeState,
  overrides: RuntimeOverrides = {},
): void {
  const storage = createInMemoryStorageBundle();
  configureStorage({
    ...storage,
    ...overrides.storage,
    conversation: {
      ...storage.conversation,
      getSession: async (id: string) => state.sessions.get(id) ?? null,
      updateSession: async (id: string, updates: Partial<Session>) => {
        const current = state.sessions.get(id);
        if (!current) return null;
        const updated = { ...current, ...updates } as Session;
        state.sessions.set(id, updated);
        return updated;
      },
      createSession: async (input: Session) => {
        const created = {
          ...input,
          createdAt: input.createdAt ?? '2026-01-01T00:00:00.000Z',
          updatedAt: input.updatedAt ?? '2026-01-01T00:00:00.000Z',
        } as Session;
        state.sessions.set(created.id, created);
        return created;
      },
      createMessage: async (message: Message) => {
        state.messages.push(message);
        return message;
      },
      updateMessage: async (id: string, updates: Partial<Message>) => {
        const index = state.messages.findIndex((message) => message.id === id);
        if (index === -1) return null;
        state.messages[index] = { ...state.messages[index], ...updates } as Message;
        return state.messages[index];
      },
      createPart: async (part: Part) => {
        state.parts.push(part);
        return part;
      },
      buildEffectiveContextHistory: async (sessionId: string) => ({
        messages: state.messages
          .filter((message) => message.sessionId === sessionId)
          .map((message) => ({
            message,
            parts: state.parts.filter((part) => part.messageId === message.id),
          })),
        latestCompactionBoundary: null,
        hasCompaction: false,
      }),
      listMessagesWithParts: async (sessionId: string) => state.messages
        .filter((message) => message.sessionId === sessionId)
        .map((message) => ({
          message,
          parts: state.parts.filter((part) => part.messageId === message.id),
        })),
      ...overrides.storage?.conversation,
    },
    workspaces: {
      ...storage.workspaces,
      get: async () => null,
      getAutoApproveSeverity: async () => 'low' as const,
    },
  });
  const bindings = {
    config: {
      getModelsConfig: () => ({ providers: [], defaultModel: 'test-model', defaultProvider: 'test-provider' }),
      listSubagentPreconfigs: async () => [preconfig],
      listPreconfigs: async () => [preconfig],
    },
    env: { getLLMSubagentMaxSteps: () => 12 },
    interaction: {
      createPendingAsk: () => 'ask-1',
      removePendingAsk: () => {},
      removePendingAsksByToolCallId: () => {},
      getPermissionRequestByRequestId: () => null,
      resolvePermissionRequestByRequestId: () => false,
      expirePermissionRequest: () => false,
      expireOldPermissionRequests: () => 0,
      cancelPendingRequestsBySession: () => 0,
      listPendingAsksBySession: () => [],
      listPendingAsksByRootSession: () => [],
      listPendingRequestsByRootSession: () => [],
      matchGrant: () => ({ matched: false, grant: null }),
      createGrantFromOptions: () => null,
      getSessionAutoApproveSeverity: () => undefined,
      getPermissionTimeoutMs: () => 1000,
      notifyPermissionRequired: () => {},
    },
    delivery: {
      emit: ({ audience, event }: RuntimeDelivery) => {
        if (audience.scope === 'ask_targets') state.askTargets.push(event);
        if (audience.scope === 'controller') state.controllerEvents.push(event);
        if (event.kind === 'terminal') state.terminalMessages.push(event.message);
      },
    },
    titles: {
      isDefaultSessionTitle: () => false,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({ tempDir: '/tmp' }),
    },
    sandbox: {
      isSandboxActive: () => false,
    },
  } as unknown as RuntimeHost;
  for (const [group, value] of Object.entries(overrides)) {
    if (group === 'storage') continue;
    const key = group as keyof RuntimeHost;
    bindings[key] = { ...bindings[key], ...value } as never;
  }
  configureRuntimeHost(bindings);
  // The retired compat barrel installed the legacy fixed-builder assembler
  // as the process default at module load; the test setup owns it now.
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  installSessionSearchToolFallback();
  installSchedulerToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
  configureRuntimeConfiguration({
    findModel: () => undefined,
    getMaxOutputTokens: () => 32000,
    findModelVariant: () => undefined,
    getModelsConfig: () => ({ providers: [], defaultModel: 'test-model', defaultProvider: 'test-provider' }),
    getLLMTemperature: () => 0.7,
    getLLMMaxSteps: () => 10,
    getLLMSubagentMaxSteps: () => 12,
    getLLMBaseUrl: () => undefined,
    getApiKey: () => undefined,
    getCompactionModel: () => undefined,
    getCompactionProvider: () => undefined,
    getCompactionMaxTokens: () => 8000,
    getCompactionPreserveRecentToolCount: () => 3,
    getCompactionPreserveSmallToolChars: () => 200,
    getCompactionToolClearCharsThreshold: () => 1000,
    getCompactionMaxPrunedToolCount: () => 50,
    getCompactionAutoThresholdRatio: () => 0.75,
    getCompactionAutoReserveCapTokens: () => 32000,
    getCompactionAutoSafetyMarginTokens: () => 20000,
  });
  configurePreconfigSource({
    get: async () => preconfig,
    getDefault: async () => preconfig,
    getForAgent: async () => preconfig,
    list: async () => [preconfig],
    listSubagents: async () => [preconfig],
  });
  configureAgentSource();
  resetProviders();
}

function createState(): RuntimeState {
  return {
    sessions: new Map([
      ['root', session('root')],
      ['child', session('child', 'root')],
    ]),
    messages: [],
    parts: [],
    askTargets: [],
    controllerEvents: [],
    terminalMessages: [],
  };
}

function requestContext(onDelivery: (delivery: RuntimeDelivery<object>) => void = () => {}) {
  return {
    emit: onDelivery,
    attachOriginToSession: () => {},
  };
}

async function* childEvents(options: ChatOptions): AsyncGenerator<StreamChatEvent> {
  options.broadcastFn?.({
    type: 'ask.request',
    id: 'ask-1',
    sessionId: 'child',
    toolCallId: 'call-1',
    toolName: 'question',
    ask: { type: 'text', question: 'Approve?' },
    createdAt: Date.now(),
  } as never);
  options.broadcastFn?.({
    type: 'ask.timeout',
    id: 'ask-1',
    sessionId: 'child',
    toolCallId: 'call-1',
    createdAt: Date.now(),
  } as never);
  const message: AssistantMessage = {
    id: 'assistant-1',
    sessionId: 'child',
    role: 'assistant',
    status: 'completed',
    modelId: 'test-model',
    providerId: 'test-provider',
    tokens: { prompt: 1, completion: 1 },
    cost: 0,
    createdAt: Date.now(),
    completedAt: Date.now(),
  };
  yield { type: 'message.created', message };
  yield {
    type: 'part.created',
    sessionId: 'child',
    part: { id: 'text-1', messageId: message.id, type: 'text', text: '', createdAt: Date.now() },
  };
  yield { type: 'part.append', sessionId: 'child', partId: 'text-1', field: 'text', delta: 'done' };
  yield { type: 'message.updated', message };
}

describe.serial('Phase 2 orchestration contracts', () => {
  test('routes child asks to the root and captures terminal output', async () => {
    const state = createState();
    bindRuntime(state);
    const delivered: RuntimeEvent[] = [];

    const result = await executeChildSession({
      parentSessionId: 'root',
      childSessionId: 'child',
      preconfig,
      prompt: 'work',
      broadcastToSession: (message) => delivered.push(message),
      streamChat: childEvents as typeof import('../src/retry/stream-chat').streamChatWithRetry,
    });

    expect(state.askTargets).toHaveLength(1);
    expect(state.askTargets[0]).toMatchObject({
      kind: 'ask',
      action: 'requested',
      sessionId: 'root',
      ask: { _originSessionId: 'child' },
    });
    expect(state.controllerEvents[0]).toMatchObject({ kind: 'ask', action: 'timed_out', sessionId: 'root' });
    expect(state.terminalMessages).toHaveLength(1);
    expect(result.parts).toMatchObject([{ type: 'text', text: 'done' }]);
    expect(delivered.map((event) => [event.kind, 'action' in event ? event.action : undefined])).toEqual([
      ['message', 'created'],
      ['part', 'created'],
      ['part', 'append'],
      ['message', 'updated'],
    ]);
  });

  test('treats exhausted child retry errors as execution failures', async () => {
    for (const type of ['error.rate_limit', 'error.server', 'error.timeout'] as const) {
      const state = createState();
      bindRuntime(state);
      const message = `${type} exhausted`;
      const result = await executeSubagent({
        description: 'research',
        prompt: 'work',
        subagent_type: 'research',
        sessionId: 'root',
        executeChild: (options) => executeChildSession({
          ...options,
          streamChat: (async function* () {
            yield { type, message } as StreamChatEvent;
          }) as typeof import('../src/retry/stream-chat').streamChatWithRetry,
        }),
      });

      expect(result.result).toBe('');
      expect(result.error).toBe(message);
      expect(state.sessions.get(result.task_id)?.subagentStatus).toBe('error');
    }
  });

  test('uses effective history when resuming a child session', async () => {
    const state = createState();
    const priorMessage: MessageWithParts = {
      message: { id: 'prior', sessionId: 'child', role: 'user', createdAt: 1 },
      parts: [],
    };
    let receivedMessageCount = 0;
    bindRuntime(state, {
      storage: {
        conversation: {
          buildEffectiveContextHistory: async () => ({
            messages: [priorMessage],
            latestCompactionBoundary: null,
            hasCompaction: false,
          }),
        },
      },
    });

    await executeChildSession({
      parentSessionId: 'root',
      childSessionId: 'child',
      preconfig,
      prompt: 'continue',
      resumeFromHistory: true,
      streamChat: (async function* (options: ChatOptions) {
        receivedMessageCount = options.messages.length;
        if (options.messages.length < 0) yield {} as StreamChatEvent;
      }) as typeof import('../src/retry/stream-chat').streamChatWithRetry,
    });

    expect(receivedMessageCount).toBe(2);
    expect(state.messages.at(-1)).toMatchObject({ sessionId: 'child', role: 'user' });
  });

  test('records met, failed, and cancelled goal-loop outcomes', async () => {
    const metState = createState();
    bindRuntime(metState);
    const turns: string[] = [];
    await runGoalLoop({
      sessionId: 'root',
      condition: 'tests pass',
      initialPrompt: 'start',
      maxTurns: 3,
      runTurn: async (content) => {
        turns.push(content);
        return { streamCompleted: true, interrupted: false };
      },
      evaluate: async ({ turn }) => ({
        goalMet: turn === 2,
        reason: turn === 2 ? 'verified' : 'still failing',
        remainingWork: 'fix one test',
      }),
    });
    expect((metState.sessions.get('root')?.metadata?.goal as GoalState).status).toBe('met');
    expect(turns[1]).toContain('Remaining work: fix one test');

    const failedState = createState();
    bindRuntime(failedState);
    await runGoalLoop({
      sessionId: 'root',
      condition: 'done',
      maxTurns: 2,
      runTurn: async () => ({ streamCompleted: true, interrupted: false }),
      evaluate: async () => ({ goalMet: false, reason: 'not yet' }),
    });
    expect((failedState.sessions.get('root')?.metadata?.goal as GoalState).status).toBe('failed');

    const cancelledState = createState();
    bindRuntime(cancelledState);
    await runGoalLoop({
      sessionId: 'root',
      condition: 'done',
      runTurn: async () => ({ streamCompleted: false, interrupted: true }),
      evaluate: async () => ({ goalMet: false, reason: 'unused' }),
    });
    expect((cancelledState.sessions.get('root')?.metadata?.goal as GoalState).status).toBe('cancelled');

    const incompleteState = createState();
    bindRuntime(incompleteState);
    let evaluations = 0;
    await runGoalLoop({
      sessionId: 'root',
      condition: 'done',
      runTurn: async () => ({ streamCompleted: false, interrupted: false }),
      evaluate: async () => {
        evaluations++;
        return { goalMet: true, reason: 'must not run' };
      },
    });
    expect((incompleteState.sessions.get('root')?.metadata?.goal as GoalState).status).toBe('failed');
    expect(evaluations).toBe(0);
  });

  test('sanitizes decomposed targets and returns structured synthesis', async () => {
    const state = createState();
    bindRuntime(state);
    const subtasks = await decomposeTask({
      prompt: 'analyze',
      parentSessionId: 'root',
      runOrchestrator: async () => ({
        text: '{}',
        json: { subtasks: [
          { prompt: 'valid', preconfigId: 'research' },
          { prompt: 'invalid', preconfigId: 'invented' },
        ] },
        sessionId: 'decomposer',
      }),
    });
    expect(subtasks.map((subtask) => subtask.preconfigId)).toEqual(['research', 'research']);

    const synthesis = await synthesizeResults({
      originalPrompt: 'analyze',
      parentSessionId: 'root',
      leafResults: [{ index: 0, text: 'finding' }],
      outputSchema: { type: 'object', properties: { answer: { type: 'string' } } },
      runOrchestrator: async (options) => {
        expect(options.systemPrompt).toContain('finding');
        return { text: '{"answer":"done"}', json: { answer: 'done' }, sessionId: 'synthesizer' };
      },
    });
    expect(synthesis).toEqual({
      text: '{"answer":"done"}',
      structuredResult: { answer: 'done' },
    });
  });

  test('records completed and error terminal subagent statuses', async () => {
    const completedState = createState();
    bindRuntime(completedState);
    const completed = await executeSubagent({
      description: 'research',
      prompt: 'work',
      subagent_type: 'research',
      sessionId: 'root',
      executeChild: async () => ({
        parts: [{ id: 'result', messageId: 'assistant', type: 'text', text: 'finished', createdAt: 1 }],
      }),
    });
    expect(completed.error).toBeUndefined();
    expect(completedState.sessions.get(completed.task_id)?.subagentStatus).toBe('completed');

    const errorState = createState();
    bindRuntime(errorState);
    const failed = await executeSubagent({
      description: 'research',
      prompt: 'work',
      subagent_type: 'research',
      sessionId: 'root',
      executeChild: async () => ({ parts: [], error: 'child failed' }),
    });
    expect(failed.error).toBe('child failed');
    expect(errorState.sessions.get(failed.task_id)?.subagentStatus).toBe('error');
  });

  test('notifies onSessionCreated exactly once when resuming', async () => {
    const state = createState();
    bindRuntime(state);
    const created: string[] = [];

    const result = await executeSubagent({
      description: 'continue research',
      prompt: 'continue',
      subagent_type: 'research',
      task_id: 'child',
      sessionId: 'root',
      onSessionCreated: (childSessionId) => { created.push(childSessionId); },
      executeChild: async () => ({ parts: [] }),
    });

    expect(result.task_id).toBe('child');
    expect(created).toEqual(['child']);
  });

  test('cancels an in-flight child execution and preserves interrupted status', async () => {
    const state = createState();
    bindRuntime(state);
    const abortController = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const result = await executeSubagent({
      description: 'research',
      prompt: 'work',
      subagent_type: 'research',
      sessionId: 'root',
      abortSignal: abortController.signal,
      executeChild: async (options) => {
        receivedSignal = options.abortSignal;
        abortController.abort(new Error('cancelled'));
        throw new Error('child aborted');
      },
    });

    expect(receivedSignal).toBe(abortController.signal);
    expect(result.error).toContain('child aborted');
    expect(state.sessions.get(result.task_id)?.subagentStatus).toBe('interrupted');
  });

  test('executes workflow fan-out and synthesis outcomes', async () => {
    const state = createState();
    bindRuntime(state);
    const result = await executeWorkflow({
      prompt: 'analyze',
      subtasks: [
        { prompt: 'first', preconfigId: 'research' },
        { prompt: 'second', preconfigId: 'research' },
      ],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['research'],
      executeLeaf: async (input) => ({
        task_id: input.prompt,
        result: `result:${input.prompt}`,
      }),
      synthesize: async ({ leafResults }) => ({
        text: leafResults.map((leaf) => leaf.text).join('|'),
      }),
    });
    expect(result.error).toBeUndefined();
    expect(result.subtaskCount).toBe(2);
    expect(result.result).toContain('result:first|result:second');

    const allFailed = await executeWorkflow({
      prompt: 'analyze',
      subtasks: [{ prompt: 'first', preconfigId: 'research' }],
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['research'],
      executeLeaf: async () => ({ task_id: 'failed', result: '', error: 'leaf failed' }),
      synthesize: async () => ({ text: 'unused' }),
    });
    expect(allFailed.error).toContain('All 1 sub-agent(s) failed');
  });

  test('reports interrupted workflows before all-failed and stops scheduling new leaves', async () => {
    const state = createState();
    bindRuntime(state);
    const abortController = new AbortController();
    const started: string[] = [];
    let releaseFirstBatch: (() => void) | undefined;
    const firstBatchReleased = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });
    let firstBatchStarted = 0;

    const workflowPromise = executeWorkflow({
      prompt: 'analyze',
      subtasks: Array.from({ length: 7 }, (_, index) => ({ prompt: `task-${index}`, preconfigId: 'research' })),
    }, {
      sessionId: 'root',
      allowedSubagentIds: ['research'],
      abortSignal: abortController.signal,
      executeLeaf: async (input) => {
        started.push(input.prompt);
        firstBatchStarted++;
        if (firstBatchStarted === 5) {
          abortController.abort();
          releaseFirstBatch?.();
        }
        await firstBatchReleased;
        return { task_id: input.prompt, result: '', error: 'cancelled leaf' };
      },
      synthesize: async () => ({ text: 'must not run' }),
    });

    const result = await workflowPromise;
    expect(started).toHaveLength(5);
    expect(result.error).toBe('Workflow was interrupted');
  });

  test('persists user content before delivery and terminal messages before notification', async () => {
    const state = createState();
    const order: string[] = [];
    bindRuntime(state, {
      storage: {
        conversation: {
          updateMessage: async (id, updates) => {
            const index = state.messages.findIndex((message) => message.id === id);
            if (index === -1) return null;
            state.messages[index] = { ...state.messages[index], ...updates } as Message;
            if (state.messages[index].role === 'assistant' && state.messages[index].status === 'completed') {
              order.push('terminal.persisted');
            }
            return state.messages[index];
          },
        },
      },
      delivery: {
        emit: ({ event }) => {
          if (event.kind === 'terminal') order.push('terminal.notified');
        },
      },
      sandbox: {
        isSandboxActive: () => true,
      },
    });
    sandboxController.setAutoResponderRules([{
      match: { mode: 'stream' },
      response: { type: 'text', content: 'done' },
      maxUses: 1,
    }]);
    registerProvider({
      descriptor: { id: 'sandbox', displayName: 'Sandbox', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'sandbox', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => ({
        model: new SandboxLanguageModel({
          sessionId: options.sessionId ?? 'root',
          modelId: options.modelId,
          providerId: 'sandbox',
        }) as unknown as LanguageModel,
      }),
    });
    state.sessions.set('root', { ...state.sessions.get('root')!, selectedProvider: 'sandbox' });
    const ws = {};

    await handleChat(requestContext(({ event }) => {
      if (event.kind === 'message' && event.action === 'created' && event.message.role === 'user') {
        expect(state.messages.some((stored) => stored.id === event.message.id)).toBe(true);
        order.push('user-message.delivered');
      }
      if (event.kind === 'part' && event.action === 'created' && event.part.type === 'text' && event.part.text === 'hello') {
        expect(state.parts.some((stored) => stored.id === event.part.id)).toBe(true);
        order.push('user-part.delivered');
      }
    }), ws, 'root', 'hello');

    expect(order).toContain('user-message.delivered');
    expect(order).toContain('user-part.delivered');
    expect(order.indexOf('terminal.persisted')).toBeLessThan(order.indexOf('terminal.notified'));
  });

  test('orders terminal persistence, host notification, message.updated, and usage delivery', async () => {
    const state = createState();
    const order: string[] = [];
    bindRuntime(state, {
      storage: {
        conversation: {
          updateMessage: async (id, updates) => {
            const index = state.messages.findIndex((message) => message.id === id);
            if (index === -1) return null;
            state.messages[index] = { ...state.messages[index], ...updates } as Message;
            if (state.messages[index].role === 'assistant' && state.messages[index].status === 'completed') {
              order.push('terminal.persisted');
            }
            return state.messages[index];
          },
          updateSession: async (id, updates) => {
            const current = state.sessions.get(id);
            if (!current) return null;
            if (updates.promptTokens !== undefined) order.push('usage.persisted');
            const updated = { ...current, ...updates } as Session;
            state.sessions.set(id, updated);
            return updated;
          },
        },
      },
      delivery: {
        emit: ({ event }) => {
          if (event.kind === 'terminal') order.push('terminal.notified');
        },
      },
      sandbox: {
        isSandboxActive: () => true,
      },
    });
    sandboxController.setAutoResponderRules([{
      match: { mode: 'stream' },
      response: { type: 'text', content: 'done' },
      maxUses: 1,
    }]);
    registerProvider({
      descriptor: { id: 'sandbox', displayName: 'Sandbox', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'sandbox', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => ({
        model: new SandboxLanguageModel({
          sessionId: options.sessionId ?? 'root',
          modelId: options.modelId,
          providerId: 'sandbox',
        }) as unknown as LanguageModel,
      }),
    });
    state.sessions.set('root', { ...state.sessions.get('root')!, selectedProvider: 'sandbox' });
    const ws = {};

    await handleChat(requestContext(({ event }) => {
      if (event.kind === 'message' && event.action === 'updated') order.push('message.updated.delivered');
      if (event.kind === 'usage') order.push('usage.delivered');
    }), ws, 'root', 'hello');

    expect(order).toContain('terminal.persisted');
    expect(order).toContain('terminal.notified');
    expect(order).toContain('message.updated.delivered');
    expect(order.indexOf('terminal.persisted')).toBeLessThan(order.indexOf('terminal.notified'));
    expect(order.indexOf('terminal.notified')).toBeLessThan(order.indexOf('message.updated.delivered'));
    expect(order.indexOf('message.updated.delivered')).toBeLessThan(order.lastIndexOf('usage.delivered'));
    expect(order.lastIndexOf('usage.delivered')).toBeLessThan(order.lastIndexOf('usage.persisted'));
  });

  test('delivers main-turn usage before persisting session usage', async () => {
    const state = createState();
    const order: string[] = [];
    bindRuntime(state, {
      storage: {
        conversation: {
          updateSession: async (id, updates) => {
            const current = state.sessions.get(id);
            if (!current) return null;
            if (updates.promptTokens !== undefined) order.push('usage.persisted');
            const updated = { ...current, ...updates } as Session;
            state.sessions.set(id, updated);
            return updated;
          },
        },
      },
      sandbox: {
        isSandboxActive: () => true,
      },
    });
    sandboxController.setAutoResponderRules([{
      match: { mode: 'stream' },
      response: { type: 'text', content: 'done' },
      maxUses: 1,
    }]);
    registerProvider({
      descriptor: { id: 'sandbox', displayName: 'Sandbox', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'sandbox', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => ({
        model: new SandboxLanguageModel({
          sessionId: options.sessionId ?? 'root',
          modelId: options.modelId,
          providerId: 'sandbox',
        }) as unknown as LanguageModel,
      }),
    });
    state.sessions.set('root', { ...state.sessions.get('root')!, selectedProvider: 'sandbox' });
    const ws = {};

    await handleChat(requestContext(({ event }) => {
      if (event.kind === 'usage') order.push('usage.delivered');
    }), ws, 'root', 'hello');

    expect(order).toContain('usage.delivered');
    expect(order.indexOf('usage.delivered')).toBeLessThan(order.indexOf('usage.persisted'));
  });

  test('delivers queue sending before deletion and title rename after persistence', async () => {
    const state = createState();
    const order: string[] = [];
    const queued = [{ id: 'queued-1', sessionId: 'root', content: 'second', createdAt: 1, position: 0 }];
    bindRuntime(state, {
      storage: {
        queue: {
          addMessage: async () => queued[0],
          peek: async () => queued[0] ?? null,
          delete: async (id) => {
            order.push(`queue.deleted:${id}`);
            queued.splice(0, 1);
            return true;
          },
        },
      },
      titles: {
        isDefaultSessionTitle: () => true,
        hasManualSessionTitle: () => false,
        generateSessionTitle: async () => 'Persisted title',
      },
      sandbox: {
        isSandboxActive: () => true,
      },
    });
    sandboxController.setAutoResponderRules([{
      match: { mode: 'stream' },
      response: { type: 'text', content: 'done' },
      maxUses: 2,
    }]);
    registerProvider({
      descriptor: { id: 'sandbox', displayName: 'Sandbox', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'sandbox', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => ({
        model: new SandboxLanguageModel({
          sessionId: options.sessionId ?? 'root',
          modelId: options.modelId,
          providerId: 'sandbox',
        }) as unknown as LanguageModel,
      }),
    });
    state.sessions.set('root', { ...state.sessions.get('root')!, selectedProvider: 'sandbox' });
    const ws = {};
    const ctx = requestContext(({ event }) => {
      if (event.kind === 'queue' && event.action === 'sending') {
        expect(queued[0]?.id).toBe(event.queueId);
        order.push(`queue.delivered:${event.queueId}`);
      }
      if (event.kind === 'session' && event.action === 'renamed') {
        expect(state.sessions.get('root')?.title).toBe(event.session.title);
        order.push('title.delivered');
      }
    });

    await handleChat(ctx, ws, 'root', 'first');
    await regenerateSessionTitle(ctx, ws, 'root', { force: true });

    expect(order.indexOf('queue.delivered:queued-1')).toBeLessThan(order.indexOf('queue.deleted:queued-1'));
    expect(order).toContain('title.delivered');
  });

  test('returns no_api_key for an unregistered provider', async () => {
    const state = createState();
    const sent: RuntimeEvent[] = [];
    bindRuntime(state);
    const ws = {};

    await handleChat(requestContext(({ audience, event }) => {
      if (audience.scope === 'origin') sent.push(event);
    }), ws, 'root', 'hello');

    expect(sent).toEqual([{
      kind: 'failure',
      category: 'generic',
      code: 'no_api_key',
      message: 'No API key configured for provider: test-provider. Register the provider or configure its API key in runtime configuration.',
    }]);
  });

  test('intercepts orchestrator model calls through the sandbox boundary', async () => {
    const state = createState();
    const contexts: Array<{ sessionId?: string; mode: string }> = [];
    sandboxController.setAutoResponderRules([{
      match: {},
      response: { type: 'text', content: '{"goalMet":true,"reason":"sandbox"}' },
    }]);
    sandboxController.setBroadcast((event) => {
      if (event.type === 'sandbox.history') {
        const latest = event.entries.at(-1);
        if (latest?.respondedAt && !latest.completedAt) {
          contexts.push({ sessionId: latest.context.sessionId, mode: latest.context.mode });
        }
      }
    });
    bindRuntime(state, {
      sandbox: {
        isSandboxActive: () => true,
      },
    });

    registerProvider({
      descriptor: { id: 'sandbox', displayName: 'Sandbox', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'sandbox', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => ({
        model: new SandboxLanguageModel({
          sessionId: options.sessionId ?? 'root',
          modelId: options.modelId,
          providerId: 'sandbox',
        }) as unknown as LanguageModel,
      }),
    });

    const result = await runOrchestratorSession({
      parentSessionId: 'root',
      title: 'Goal evaluator',
      agentName: 'goal-evaluator',
      systemPrompt: 'Evaluate',
      userPrompt: 'Is it done?',
      broadcast: () => {},
      broadcastSessionCreated: () => {},
      broadcastSessionUpdated: () => {},
    });

    expect(result.json).toEqual({ goalMet: true, reason: 'sandbox' });
    expect(contexts).toEqual([{ sessionId: 'root', mode: 'stream' }]);
    expect(state.sessions.get(result.sessionId)?.subagentStatus).toBe('completed');

    sandboxController.setAutoResponderRules([{
      match: {},
      response: { type: 'text', content: '{"goalMet":true,"reason":"goal sandbox"}' },
    }]);
    expect((await evaluateGoal({
      sessionId: 'root',
      condition: 'done',
      turn: 1,
      maxTurns: 2,
      broadcast: () => {},
      broadcastSessionCreated: () => {},
      broadcastSessionUpdated: () => {},
    })).goalMet).toBe(true);

    sandboxController.setAutoResponderRules([{
      match: {},
      response: { type: 'text', content: 'tool llm answer' },
    }]);
    expect(await createLlmApi('test-model', 'test-provider', 'child').generateText({
      prompt: 'tool prompt',
    })).toBe('tool llm answer');
    expect(contexts.slice(-2)).toEqual([
      { sessionId: 'root', mode: 'stream' },
      { sessionId: 'child', mode: 'stream' },
    ]);
  });

  test('enforces depth and resume ownership contracts', async () => {
    const state = createState();
    state.sessions.set('grandchild', session('grandchild', 'child'));
    bindRuntime(state);
    expect(await canSpawnSubagent('root')).toBe(true);
    expect(await canSpawnSubagent('child')).toBe(true);
    expect(await canSpawnSubagent('grandchild')).toBe(false);
    const child = { parentId: 'parent-1', preconfigId: 'research' };
    expect(getSubagentResumeError(child, 'parent-2', 'research')).toContain('does not belong');
    expect(getSubagentResumeError(child, 'parent-1', 'coding')).toContain('not "coding"');
  });
});
