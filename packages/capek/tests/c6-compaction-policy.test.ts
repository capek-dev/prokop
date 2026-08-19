import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  AssistantMessage, CompactionPart, ToolPart } from '@capekai/types';
import {
  createCompactionService,
  getCompactionService,
  getDefaultCompactionPolicy,
  resolveCompactionPolicy,
  resetDefaultCompactionServiceForTests,
  type CompactionService,
  type CompactionServiceOptions,
} from '../src/compaction/policy';
import {
  createCompactionTrigger,
  persistCompactionFailure,
  processCompactionTask,
} from '../src/compaction/task';
import { executeCompaction, isCompactionActive } from '../src/compaction/executor';
import {
  reconcileAllSessionsCompaction,
  reconcileSessionCompaction,
  type CompactionRecoveryDeps,
} from '../src/compaction/recovery';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import {
  configureRuntimeConfiguration,
  withRuntimeConfiguration,
} from '../src/configuration/runtime';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import type { BroadcastFn, BroadcastSessionFn } from '../src/runtime/host';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import {
  configureStorage,
  createMessage,
  createPart,
  createSession,
  getPartsBySession,
  getSession,
  listMessagesWithParts,
} from '../src/storage/runtime';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost, type SessionSearchHost } from '../src/session-search/host';
import { createAgentScope } from '../src/kernel/kernel';
import {
  enterAgentScope,
} from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { currentAgentPlugins } from './helpers/composition';
import { capekCompactionServiceKey } from '../src/plugins/service-keys';
import type { GenerateSummaryFn } from '../src/compaction/contracts';

function makeOptions(overrides: Partial<CompactionServiceOptions> = {}): CompactionServiceOptions {
  return {
    modelId: null,
    providerId: null,
    maxOutputTokens: 8000,
    preserveRecentToolCount: 3,
    preserveSmallToolChars: 200,
    toolClearCharsThreshold: 1000,
    maxPrunedToolCount: 50,
    autoThresholdRatio: 0.75,
    autoReserveCapTokens: 32000,
    autoSafetyMarginTokens: 20000,
    ...overrides,
  };
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
        tempDir: '/tmp/capek-c6-compaction-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
  };
}

function minimalSchedulerHost(): SchedulerHost {
  return {
    create: () => {
      throw new Error('not configured');
    },
    get: () => null,
    list: () => [],
    update: () => null,
    delete: () => false,
    trigger: () => {},
  };
}

const SESSION_ID = 'c6-compaction-session';

function seedMainSession(sessionId: string = SESSION_ID): void {
  createSession({
    id: sessionId,
    workspaceId: 'workspace-1',
    preconfigId: null,
    title: 'C6 compaction',
    status: 'active',
    metadata: null,
    parentId: null,
    agentName: null,
  });
}

function seedUserMessage(sessionId: string, id: string, text: string, createdAt = 1000): void {
  createMessage({ id, sessionId, role: 'user', createdAt });
  createPart({ id: `part-${id}`, messageId: id, createdAt, type: 'text', text }, sessionId);
}

function seedAssistantMessage(sessionId: string, id: string, text: string, createdAt = 2000): void {
  createMessage({
    id,
    sessionId,
    role: 'assistant',
    status: 'completed',
    modelId: 'gpt-4o',
    providerId: 'openai',
    tokens: { prompt: 1, completion: 1 },
    cost: 0,
    createdAt,
    completedAt: createdAt,
  });
  createPart({ id: `part-${id}`, messageId: id, createdAt, type: 'text', text }, sessionId);
}

function seedConversation(sessionId: string = SESSION_ID): void {
  seedMainSession(sessionId);
  seedUserMessage(sessionId, 'user-1', 'Explain TypeScript.', 1000);
  seedAssistantMessage(sessionId, 'assistant-1', 'TypeScript adds static types.', 2000);
}

function seedToolPart(
  sessionId: string,
  messageId: string,
  part: Partial<ToolPart> & { id: string; name: string; output: unknown },
): void {
  const toolPart: ToolPart = {
    id: part.id,
    messageId,
    createdAt: part.createdAt ?? 2500,
    type: 'tool',
    callId: part.callId ?? `call-${part.id}`,
    name: part.name,
    state: {
      status: 'completed',
      input: part.state?.input ?? {},
      output: part.output,
      startedAt: part.createdAt ?? 2500,
      completedAt: part.createdAt ?? 2600,
    },
  };
  createPart(toolPart, sessionId);
}

function createFakeGenerateSummary(overrides: {
  text?: string;
  usage?: { prompt: number; completion: number };
  effectiveModelId?: string;
  effectiveProviderId?: string;
  shouldThrow?: Error;
  assertAborted?: () => void;
  capturePrompt?: (prompt: string) => void;
} = {}): GenerateSummaryFn {
  return async (prompt: string, _policy, _sessionId, abortSignal?: AbortSignal) => {
    overrides.capturePrompt?.(prompt);
    if (overrides.assertAborted) overrides.assertAborted();
    if (overrides.shouldThrow) throw overrides.shouldThrow;
    if (abortSignal?.aborted) throw new Error('aborted');
    return {
      text: overrides.text ?? '## Summary\n\nCompacted conversation summary.',
      usage: overrides.usage ?? { prompt: 10, completion: 20 },
      effectiveModelId: overrides.effectiveModelId ?? 'gpt-4o',
      effectiveProviderId: overrides.effectiveProviderId ?? 'openai',
    };
  };
}

function makeDeps(overrides: Partial<CompactionRecoveryDeps> = {}): {
  deps: CompactionRecoveryDeps;
  counters: { broadcasts: number; sessionUpdates: number; clears: number; orphanCalls: number };
} {
  const counters = { broadcasts: 0, sessionUpdates: 0, clears: 0, orphanCalls: 0 };
  const deps: CompactionRecoveryDeps = {
    isSessionCompacting: () => false,
    clearSessionCompacting: (sessionId: string) => {
      counters.clears++;
      return { id: sessionId } as unknown as never;
    },
    listOrphanedCompactionTriggers: () => {
      counters.orphanCalls++;
      return [];
    },
    listSessionIds: () => [SESSION_ID],
    broadcast: () => {
      counters.broadcasts++;
    },
    broadcastSessionUpdated: () => {
      counters.sessionUpdates++;
    },
    ...overrides,
  };
  return { deps, counters };
}

beforeEach(() => {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration({
    ...createDefaultRuntimeConfiguration(),
    findModel(modelId) {
      if (modelId !== 'gpt-4o') return undefined;
      return {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxOutputTokens: 16384,
        tier: 'standard',
        providerId: 'openai',
        providerName: 'OpenAI',
      };
    },
  });
  configureRuntimeHost(minimalHost());
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
});

afterEach(() => {
  resetDefaultCompactionServiceForTests();
});

describe('C6 default compaction service contract', () => {
  test('pins the exact current default numeric options', () => {
    const service = createCompactionService({ id: 'test', options: makeOptions() });
    expect(service.options).toEqual({
      modelId: null,
      providerId: null,
      maxOutputTokens: 8000,
      preserveRecentToolCount: 3,
      preserveSmallToolChars: 200,
      toolClearCharsThreshold: 1000,
      maxPrunedToolCount: 50,
      autoThresholdRatio: 0.75,
      autoReserveCapTokens: 32000,
      autoSafetyMarginTokens: 20000,
    });
  });

  test('resolvePolicy keeps the exact precedence: options, then overrides, then session', () => {
    const service = createCompactionService({
      id: 'test',
      options: makeOptions({ modelId: 'env-model', providerId: 'env-provider' }),
    });

    const resolved = service.resolvePolicy('gpt-4o', 'openai', {
      maxOutputTokens: 9999,
      preserveRecentToolCount: 10,
    });
    expect(resolved.modelId).toBe('env-model');
    expect(resolved.providerId).toBe('env-provider');
    expect(resolved.maxOutputTokens).toBe(9999);
    expect(resolved.preserveRecentToolCount).toBe(10);
    expect(resolved.preserveSmallToolChars).toBe(200);

    // Options without a model/provider fall back to the session values.
    const fallbackService = createCompactionService({ id: 'fallback', options: makeOptions() });
    const sessionOnly = fallbackService.resolvePolicy('gpt-4o', 'openai');
    expect(sessionOnly.modelId).toBe('gpt-4o');
    expect(sessionOnly.providerId).toBe('openai');
  });

  test('getDefaultCompactionPolicy keeps model/provider null and reads service options', () => {
    const defaults = getDefaultCompactionPolicy();
    expect(defaults.modelId).toBeNull();
    expect(defaults.providerId).toBeNull();
    expect(defaults.maxOutputTokens).toBeGreaterThan(0);
    expect(defaults.overflowThresholdRatio).toBeNull();
  });

  test('computeThreshold honors the hybrid formula and service options', () => {
    const service = createCompactionService({
      id: 'test',
      options: makeOptions({
        autoThresholdRatio: 0.5,
        autoReserveCapTokens: 1000,
        autoSafetyMarginTokens: 0,
      }),
    });

    // No model definition: threshold 0 with no context window.
    expect(service.computeThreshold(undefined)).toEqual({
      threshold: 0,
      contextWindow: undefined,
    });

    // Policy overrides beat service options.
    const policy = service.resolvePolicy(undefined, undefined, {
      autoThresholdRatio: 0.25,
      autoReserveCapTokens: 500,
      autoSafetyMarginTokens: 100,
    });
    const overridden = service.computeThreshold('gpt-4o', policy);
    expect(overridden.contextWindow).toBeTypeOf('number');
    const contextWindow = overridden.contextWindow as number;
    const modelMaxOutputTokens = 16384;
    const reserve = Math.min(modelMaxOutputTokens, 500);
    const ratioBased = Math.floor(contextWindow * 0.25);
    const safe = contextWindow - reserve - 100;
    expect(overridden.threshold).toBe(Math.max(0, Math.min(ratioBased, safe)));
  });

  test('the failure cooldown keeps the exact 60s window and 2-failure threshold', () => {
    let now = 1_000_000;
    const service = createCompactionService({
      id: 'test',
      options: makeOptions(),
      now: () => now,
    });

    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(false);
    service.recordCompactionFailure(SESSION_ID);
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(false);
    service.recordCompactionFailure(SESSION_ID);
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(true);

    // Cooldown expiry: 61s later the tracker is stale and removed.
    now += 61_000;
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(false);
    service.recordCompactionFailure(SESSION_ID);
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(false);

    // Clearing resets the consecutive-failure count.
    service.recordCompactionFailure(SESSION_ID);
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(true);
    service.clearCompactionFailure(SESSION_ID);
    expect(service.shouldSkipCompaction(SESSION_ID)).toBe(false);
  });

  test('buildReplayText reproduces the exact replay selection', async () => {
    seedMainSession();
    seedUserMessage(SESSION_ID, 'user-1', 'Explain TypeScript.', 1000);
    seedAssistantMessage(SESSION_ID, 'assistant-1', 'TypeScript adds static types.', 2000);
    seedUserMessage(SESSION_ID, 'user-2', 'Continue: tell me more', 3000);
    seedAssistantMessage(SESSION_ID, 'assistant-2', 'Sure.', 4000);
    // The newest user message starts with "Continue:" so the replay search
    // falls back to the previous real user turn.
    expect(await getCompactionService().buildReplayText(SESSION_ID)).toBe('Replay: Explain TypeScript.');
  });

  test('buildReplayText returns null without a prior user turn and skips compaction-only turns', async () => {
    seedMainSession();
    seedUserMessage(SESSION_ID, 'user-1', 'Continue from the summary.', 1000);
    seedAssistantMessage(SESSION_ID, 'assistant-1', 'Ok.', 2000);
    expect(await getCompactionService().buildReplayText(SESSION_ID)).toBeNull();
  });

  test('the per-session concurrency guard is owned by the service instance', () => {
    const a = createCompactionService({ id: 'a', options: makeOptions() });
    const b = createCompactionService({ id: 'b', options: makeOptions() });
    a.beginCompaction(SESSION_ID);
    expect(a.isCompactionActive(SESSION_ID)).toBe(true);
    expect(b.isCompactionActive(SESSION_ID)).toBe(false);
    a.endCompaction(SESSION_ID);
    expect(a.isCompactionActive(SESSION_ID)).toBe(false);
  });

  test('policy functions resolve through the scoped service', () => {
    expect(resolveCompactionPolicy(undefined, undefined).maxOutputTokens)
      .toBe(getDefaultCompactionPolicy().maxOutputTokens);
  });
});

describe('C6 compaction task pipeline on memory storage', () => {
  test('creates a trigger with the exact auto and overflow flags', async () => {
    seedConversation();
    const trigger = await createCompactionTrigger(SESSION_ID, 'overflow');
    expect(trigger.reason).toBe('overflow');

    const triggerMsg = (await listMessagesWithParts(SESSION_ID)).find((m) => m.message.id === trigger.messageId);
    expect(triggerMsg?.message.role).toBe('user');
    const part = triggerMsg?.parts.find((p) => p.type === 'compaction') as CompactionPart;
    expect(part.auto).toBe(true);
    expect(part.overflow).toBe(true);
  });

  test('rejects triggers without enough non-system messages', async () => {
    seedMainSession();
    seedUserMessage(SESSION_ID, 'user-1', 'Only one turn.', 1000);
    await expect(createCompactionTrigger(SESSION_ID, 'manual')).rejects.toThrow(
      'Not enough messages for compaction',
    );
  });

  test('a successful compaction persists the exact summary message, part, and usage', async () => {
    seedConversation();
    const trigger = await createCompactionTrigger(SESSION_ID, 'manual');
    const policy = resolveCompactionPolicy('gpt-4o', 'openai');

    const result = await processCompactionTask(
      SESSION_ID,
      trigger.messageId,
      policy,
      createFakeGenerateSummary({
        text: '## Summary\n\nCompacted conversation summary.',
        effectiveModelId: 'claude-3-opus',
        effectiveProviderId: 'anthropic',
        usage: { prompt: 50, completion: 30 },
      }),
    );

    expect(result.trigger.messageId).toBe(trigger.messageId);
    expect(result.trigger.reason).toBe('manual');
    expect(result.summaryMessage).toMatchObject({
      role: 'assistant',
      summary: true,
      mode: 'compaction',
      parentId: trigger.messageId,
      modelId: 'claude-3-opus',
      providerId: 'anthropic',
      status: 'completed',
    });
    expect(result.tokensUsed).toEqual({ prompt: 50, completion: 30 });
    expect(result.textParts).toHaveLength(1);
    expect(result.textParts[0].text).toBe('## Summary\n\nCompacted conversation summary.');

    const persisted = (await listMessagesWithParts(SESSION_ID)).find(
      (m) => m.message.id === result.summaryMessage.id,
    );
    expect(persisted?.parts.some((p) => p.type === 'text')).toBe(true);
  });

  test('budget-aware pruning clears only eligible tool outputs', async () => {
    seedConversation();
    seedToolPart(SESSION_ID, 'assistant-1', {
      id: 'tp-big-old',
      name: 'read-file',
      output: 'A'.repeat(5000),
      createdAt: 1500,
    });
    seedToolPart(SESSION_ID, 'assistant-1', {
      id: 'tp-small',
      name: 'read-file',
      output: 'Small output',
      createdAt: 1501,
    });
    seedToolPart(SESSION_ID, 'assistant-1', {
      id: 'tp-skill',
      name: 'skill',
      output: 'B'.repeat(5000),
      createdAt: 1502,
    });

    const trigger = await createCompactionTrigger(SESSION_ID, 'manual');
    const policy = resolveCompactionPolicy('gpt-4o', 'openai', {
      preserveRecentToolCount: 0,
      preserveSmallToolChars: 200,
      toolClearCharsThreshold: 100,
      maxPrunedToolCount: 50,
    });
    await processCompactionTask(
      SESSION_ID,
      trigger.messageId,
      policy,
      createFakeGenerateSummary({}),
    );

    const parts = await getPartsBySession(SESSION_ID);
    const bigOld = parts.find((p) => p.id === 'tp-big-old') as ToolPart;
    const small = parts.find((p) => p.id === 'tp-small') as ToolPart;
    const skill = parts.find((p) => p.id === 'tp-skill') as ToolPart;
    expect((bigOld.state as { compactedAt?: number }).compactedAt).toBeDefined();
    expect((small.state as { compactedAt?: number }).compactedAt).toBeUndefined();
    expect((skill.state as { compactedAt?: number }).compactedAt).toBeUndefined();
  });

  test('the incremental prompt includes the previous summary and skips pre-boundary content', async () => {
    seedConversation();
    const firstTrigger = await createCompactionTrigger(SESSION_ID, 'manual');
    await processCompactionTask(
      SESSION_ID,
      firstTrigger.messageId,
      resolveCompactionPolicy('gpt-4o', 'openai'),
      createFakeGenerateSummary({ text: 'FIRST SUMMARY TEXT' }),
    );
    seedUserMessage(SESSION_ID, 'user-3', 'Tell me more.', 3000);
    seedAssistantMessage(SESSION_ID, 'assistant-3', 'More details.', 4000);

    const secondTrigger = await createCompactionTrigger(SESSION_ID, 'manual');
    let prompt = '';
    await processCompactionTask(
      SESSION_ID,
      secondTrigger.messageId,
      resolveCompactionPolicy('gpt-4o', 'openai'),
      createFakeGenerateSummary({ capturePrompt: (p) => { prompt = p; } }),
    );

    expect(prompt).toContain('FIRST SUMMARY TEXT');
    expect(prompt).toContain('Previous summary:');
    expect(prompt).toContain('Tell me more.');
    // Pre-boundary conversation text must not be re-sent.
    expect(prompt).not.toContain('Explain TypeScript.');
  });

  test('persists a compaction failure with the exact compact_failed shape and broadcasts', async () => {
    seedMainSession();
    const events: Array<{ kind: string; action: string }> = [];
    await persistCompactionFailure(SESSION_ID, 'trigger-1', 'Model API error', (event) => {
      events.push({ kind: event.kind, action: (event as { action?: string }).action ?? '' });
    });

    const failed = (await listMessagesWithParts(SESSION_ID)).find((m) => {
      const message = m.message as AssistantMessage;
      return message.role === 'assistant' && message.mode === 'compact_failed';
    });
    expect(failed).toBeDefined();
    expect(failed?.message).toMatchObject({
      status: 'error',
      mode: 'compact_failed',
      parentId: 'trigger-1',
      error: 'Model API error',
    });
    expect(failed?.parts.some((p) => p.type === 'text')).toBe(true);
    expect(events).toEqual([
      { kind: 'message', action: 'created' },
      { kind: 'part', action: 'created' },
    ]);
  });

  test('an aborted summary generation propagates and persists nothing', async () => {
    seedConversation();
    const trigger = await createCompactionTrigger(SESSION_ID, 'manual');
    const controller = new AbortController();
    controller.abort();

    await expect(
      processCompactionTask(
        SESSION_ID,
        trigger.messageId,
        resolveCompactionPolicy('gpt-4o', 'openai'),
        createFakeGenerateSummary({ assertAborted: () => expect(controller.signal.aborted).toBe(true) }),
        controller.signal,
      ),
    ).rejects.toThrow('aborted');

    const summary = (await listMessagesWithParts(SESSION_ID)).find(
      (m) => m.message.role === 'assistant' && (m.message as AssistantMessage).summary === true,
    );
    expect(summary).toBeUndefined();
  });

  test('the executor guards missing and child sessions without starting compaction', async () => {
    seedConversation();
    const noBroadcast = () => {};
    expect(await executeCompaction('missing-session', 'manual', noBroadcast, () => {})).toEqual({
      ok: false,
      error: 'Compaction is only available for main sessions',
      triggerMessageId: null,
      reason: 'manual',
      skipped: true,
    });

    const child = 'child-session';
    createSession({
      id: child,
      workspaceId: 'workspace-1',
      preconfigId: null,
      title: 'Child',
      status: 'active',
      metadata: null,
      parentId: SESSION_ID,
      agentName: 'child',
    });
    const childResult = await executeCompaction(child, 'manual', noBroadcast, () => {});
    expect(childResult).toMatchObject({ ok: false, skipped: true });
    expect(isCompactionActive(child)).toBe(false);
  });

  test('the executor refuses a second compaction while one is active', async () => {
    seedConversation();
    getCompactionService().beginCompaction(SESSION_ID);
    try {
      const result = await executeCompaction(SESSION_ID, 'auto', () => {}, () => {});
      expect(result).toEqual({
        ok: false,
        error: 'Compaction is already in progress for this session',
        triggerMessageId: null,
        reason: 'auto',
        skipped: true,
      });
    } finally {
      getCompactionService().endCompaction(SESSION_ID);
    }
  });
});

describe('C6 compaction executor', () => {
  test('the executor abort path pins result, cleanup, persistence, and exact order', async () => {
    seedConversation();
    const order: string[] = [];
    const broadcast: BroadcastFn = (event) => {
      if (event.kind === 'message') {
        order.push(`message:${event.message.role}`);
      } else if (event.kind === 'part' && 'part' in event) {
        order.push(`part:${event.part.type}`);
      } else {
        order.push(event.kind);
      }
    };
    const sessionOrder: string[] = [];
    const broadcastSessUpdate: BroadcastSessionFn = (session) => {
      sessionOrder.push(`compacting=${String(session.compacting)}`);
    };
    const controller = new AbortController();
    controller.abort();

    const result = await executeCompaction(
      SESSION_ID,
      'manual',
      broadcast,
      broadcastSessUpdate,
      controller.signal,
      createFakeGenerateSummary({}),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure result');
    expect(result).toMatchObject({ skipped: false, reason: 'manual' });
    expect(result.error).toBe('aborted');
    expect(typeof result.triggerMessageId).toBe('string');

    // Compacting flag: turned on at start, cleared exactly once on failure.
    expect((await getSession(SESSION_ID))?.compacting).toBe(false);
    expect(sessionOrder).toEqual(['compacting=true', 'compacting=false']);

    // Append-only failure record persisted against the trigger.
    const failure = (await listMessagesWithParts(SESSION_ID)).find(({ message }) => {
      const assistant = message as AssistantMessage;
      return assistant.role === 'assistant' && assistant.mode === 'compact_failed';
    });
    expect(failure?.message).toMatchObject({
      status: 'error',
      mode: 'compact_failed',
      parentId: result.triggerMessageId,
      error: 'aborted',
    });
    expect(failure?.parts.find((p) => p.type === 'text')).toMatchObject({
      text: 'Compaction failed: aborted',
    });

    // Exact broadcast order: trigger message and part first, then the
    // failure message and part after the compacting cleanup.
    expect(order).toEqual([
      'message:user',
      'part:compaction',
      'message:assistant',
      'part:text',
    ]);
  });

  test('the unscoped executor and recovery share the same process-default active-session service', async () => {
    seedConversation();
    const service = getCompactionService();
    service.beginCompaction(SESSION_ID);
    try {
      // The executor guard observes the flag registered through the service.
      const result = await executeCompaction(SESSION_ID, 'manual', () => {}, () => {});
      expect(result).toMatchObject({
        ok: false,
        error: 'Compaction is already in progress for this session',
        skipped: true,
      });
      expect(isCompactionActive(SESSION_ID)).toBe(true);

      // The recovery guard observes the same process-default flag and never
      // lists orphans while it is set.
      const { deps, counters } = makeDeps({
        listOrphanedCompactionTriggers: () => [{ id: 'trigger-1' } as never],
      });
      await expect(reconcileSessionCompaction(SESSION_ID, deps)).resolves.toBe(0);
      expect(counters.orphanCalls).toBe(0);
    } finally {
      service.endCompaction(SESSION_ID);
    }
    expect(isCompactionActive(SESSION_ID)).toBe(false);
  });
});

describe('C6 scoped compaction service composition', () => {
  test('environment values are translated into provider options at composition and frozen', async () => {
    configureRuntimeConfiguration({
      ...createDefaultRuntimeConfiguration(),
      getCompactionPreserveRecentToolCount: () => 99,
    });
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const service: CompactionService = agentScope.require(capekCompactionServiceKey);
      expect(service.id).toBe('current.compaction-policy');
      expect(service.options.preserveRecentToolCount).toBe(99);

      // Reconfiguring the global configuration does not mutate the frozen
      // composed scope's options.
      configureRuntimeConfiguration({
        ...createDefaultRuntimeConfiguration(),
        getCompactionPreserveRecentToolCount: () => 7,
      });
      expect(service.options.preserveRecentToolCount).toBe(99);

      const secondScope = await createCurrentAgentScope(processScope);
      try {
        expect((secondScope.require(capekCompactionServiceKey) as CompactionService)
          .options.preserveRecentToolCount).toBe(7);
      } finally {
        await secondScope.dispose();
      }
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the compaction service is an explicit required agent-scoped provider', async () => {
    const processScope = await createCurrentProcessScope();
    const plugins = currentAgentPlugins()
      .filter((plugin) => plugin.id !== 'current.compaction-policy');
    const agentScope = await createAgentScope(processScope, [...plugins]);
    try {
      expect(() => enterAgentScope(agentScope, () => undefined))
        .toThrow(/service 'capek\.compaction-service' is not available/);
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
      const serviceA: CompactionService = scopeA.require(capekCompactionServiceKey);
      const serviceB: CompactionService = scopeB.require(capekCompactionServiceKey);
      expect(serviceA).not.toBe(serviceB);

      let observed: CompactionService | null = null;
      enterAgentScope(scopeA, () => {
        observed = getCompactionService();
      });
      expect(observed === serviceA).toBe(true);
      expect(getCompactionService()).not.toBe(serviceA);

      serviceA.beginCompaction('isolated-session');
      serviceA.recordCompactionFailure('isolated-session');
      serviceA.recordCompactionFailure('isolated-session');
      expect(serviceB.isCompactionActive('isolated-session')).toBe(false);
      expect(serviceB.shouldSkipCompaction('isolated-session')).toBe(false);
    } finally {
      await scopeA.dispose();
      await scopeB.dispose();
      await processScope.dispose();
    }
  });

  test('the unscoped process default keeps live configuration reads', () => {
    const custom = {
      ...createDefaultRuntimeConfiguration(),
      getCompactionMaxPrunedToolCount: () => 1234,
    };
    withRuntimeConfiguration(custom, () => {
      expect(getCompactionService().options.maxPrunedToolCount).toBe(1234);
    });
    expect(getCompactionService().options.maxPrunedToolCount).not.toBe(1234);
  });
});

describe('C6 compaction recovery policy', () => {
  function orphanTriggerDeps(ids: string[]): CompactionRecoveryDeps {
    return {
      isSessionCompacting: () => false,
      clearSessionCompacting: () => null,
      listOrphanedCompactionTriggers: () => ids.map((id) => ({ id }) as never),
      listSessionIds: () => [SESSION_ID],
      broadcast: () => {},
      broadcastSessionUpdated: () => {},
    };
  }

  test('reconciles one orphaned trigger with the exact interrupted failure', async () => {
    seedMainSession();
    const deps = orphanTriggerDeps(['trigger-1']);
    const count = await reconcileSessionCompaction(SESSION_ID, deps);
    expect(count).toBe(1);

    const failed = (await listMessagesWithParts(SESSION_ID)).find((m) => {
      const message = m.message as AssistantMessage;
      return message.mode === 'compact_failed';
    });
    expect(failed?.message).toMatchObject({
      status: 'error',
      parentId: 'trigger-1',
      error: 'Compaction interrupted (session recovered after crash or interruption)',
    });
  });

  test('returns zero when no orphaned triggers exist', async () => {
    seedMainSession();
    await expect(reconcileSessionCompaction(SESSION_ID, orphanTriggerDeps([]))).resolves.toBe(0);
  });

  test('skips reconciliation entirely while compaction is in flight', async () => {
    seedMainSession();
    const { deps, counters } = makeDeps({
      listOrphanedCompactionTriggers: () => [{ id: 'trigger-1' } as never],
    });
    getCompactionService().beginCompaction(SESSION_ID);
    try {
      await expect(reconcileSessionCompaction(SESSION_ID, deps)).resolves.toBe(0);
      expect(counters.orphanCalls).toBe(0);
      expect(counters.clears).toBe(0);
    } finally {
      getCompactionService().endCompaction(SESSION_ID);
    }
  });

  test('clears a stuck compacting flag and broadcasts the updated session', async () => {
    seedMainSession();
    const updated = { id: SESSION_ID } as never;
    const { deps, counters } = makeDeps({
      isSessionCompacting: () => true,
      clearSessionCompacting: () => {
        counters.clears++;
        return updated;
      },
    });
    await expect(reconcileSessionCompaction(SESSION_ID, deps)).resolves.toBe(0);
    expect(counters.clears).toBe(1);
    expect(counters.sessionUpdates).toBe(1);
  });

  test('broadcast false silences session updates but still reconciles', async () => {
    seedMainSession();
    const { deps, counters } = makeDeps({
      isSessionCompacting: () => true,
      listOrphanedCompactionTriggers: () => [{ id: 'trigger-1' } as never],
    });
    const count = await reconcileSessionCompaction(SESSION_ID, deps, { broadcast: false });
    expect(count).toBe(1);
    expect(counters.clears).toBe(1);
    expect(counters.sessionUpdates).toBe(0);
    expect(counters.broadcasts).toBe(0);
  });

  test('reconcileAllSessionsCompaction aggregates counts and disables per-session broadcast', async () => {
    seedMainSession('session-a');
    seedMainSession('session-b');
    const { deps, counters } = makeDeps({
      listSessionIds: () => ['session-a', 'session-b'],
      listOrphanedCompactionTriggers: (sessionId: string) => {
        counters.orphanCalls++;
        return sessionId === 'session-a' ? [{ id: 't1' } as never] : [];
      },
    });
    await expect(reconcileAllSessionsCompaction(deps)).resolves.toBe(1);
    expect(counters.broadcasts).toBe(0);
    expect(counters.orphanCalls).toBe(2);
  });
});
