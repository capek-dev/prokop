import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelMessage } from 'ai';
import type { LoadedTool } from '@prokopai/sdk/tool';
import type { Preconfig } from '@prokopai/sdk/types';
import { createComposition, createProcessScope, enterAgentScope, facadeProcessPlugins } from '#tests/engine/helpers/standalone-composition';
import { createSingleModelConfiguration } from '@/infrastructure/providers/configuration/single-model';
import { createStandaloneHost } from '#tests/engine/helpers/standalone-host';
import { createInMemoryStorageBundle } from '@/infrastructure/storage/memory';
import { SandboxController } from '@/infrastructure/sandbox/controller';
import { SandboxProvider } from '@/infrastructure/sandbox/provider';
import type { AutoResponderRule, SandboxHistoryEntry } from '@/infrastructure/sandbox/types';
import { streamChatWithRetry, type StreamChatEvent, type StreamChatFn } from '@/harnesses/prokop/retry/stream-chat';
import { executeCompaction } from '@/harnesses/prokop/compaction/executor';
import { estimateMessageTokens, estimateNextStepTokens } from '@/harnesses/prokop/compaction/usage';
import { interruptManager } from '@/harnesses/prokop/execution/interrupt';
import { handleChat } from '@/harnesses/prokop/execution/chat-handler';
import type { RuntimeEvent } from '@/infrastructure/runtime/events';

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

const preconfig: Preconfig = {
  id: 'test', name: 'test', description: '', systemPrompt: 'Finish the task.',
  tools: ['work'], model: 'test-model', provider: 'sandbox', settings: null, isDefault: true,
};
const text = (content: string): AutoResponderRule => ({ match: {}, response: { type: 'text', content }, maxUses: 1 });
const work = (): AutoResponderRule => ({ match: {}, response: { type: 'tool-call', toolName: 'work', args: {} }, maxUses: 1 });

async function fixture(rules: AutoResponderRule[], run: (fixture: {
  storage: ReturnType<typeof createInMemoryStorageBundle>;
  sessionId: string;
  history: SandboxHistoryEntry[];
  events: RuntimeEvent[];
  executions: () => number;
}) => Promise<void>, thresholdRatio = 0.75, onEvent?: (event: RuntimeEvent) => void): Promise<void> {
  const storage = createInMemoryStorageBundle();
  const sessionId = crypto.randomUUID();
  const history: SandboxHistoryEntry[] = [];
  const events: RuntimeEvent[] = [];
  const controller = new SandboxController([...rules, text('unexpected extra model call')]);
  controller.setBroadcast(event => {
    if (event.type === 'sandbox.history') history.splice(0, history.length, ...event.entries);
  });
  let executions = 0;
  const tool: LoadedTool = {
    definition: { name: 'work', description: 'Perform one bounded action.', inputSchema: { type: 'object', properties: {} }, timeout: 1000 },
    execute: async () => { executions++; return { success: true, result: 'x'.repeat(4000) }; },
    path: 'builtin:test',
  };
  const base = createSingleModelConfiguration({ modelId: 'test-model', providerId: 'sandbox' });
  const configuration = {
    ...base,
    findModel: () => ({ ...base.findModel('test-model')!, contextWindow: 1000 }),
    getCompactionAutoThresholdRatio: () => thresholdRatio,
    getCompactionAutoReserveCapTokens: () => 0,
    getCompactionAutoSafetyMarginTokens: () => 0,
  };
  const tempRoot = await mkdtemp(join(tmpdir(), 'capek-goal-compaction-'));
  tempRoots.push(tempRoot);
  const host = createStandaloneHost({ workspace: process.cwd(), sandboxActive: true, tempRoot });
  host.delivery.emit = delivery => {
    events.push(delivery.event);
    onEvent?.(delivery.event);
  };
  host.titles.isDefaultSessionTitle = () => false;
  const processScope = await createProcessScope([...facadeProcessPlugins()]);
  const { agentScope } = await createComposition(processScope, {
    storage, configuration, host, sandboxController: controller,
    providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
    loadedTools: [tool], workspaceToolDiscovery: {},
    contextSources: { preconfigs: {
      get: async () => preconfig, getDefault: async () => preconfig,
      getForAgent: async () => preconfig, list: async () => [preconfig], listSubagents: async () => [],
    } },
  });
  try {
    await enterAgentScope(agentScope, async () => {
      await storage.conversation.createSession({
        id: sessionId, workspaceId: 'test', preconfigId: 'test', title: 'Test', status: 'active',
        parentId: null, agentName: null, metadata: null, selectedModel: 'test-model', selectedProvider: 'sandbox',
      });
      await run({ storage, sessionId, history, events, executions: () => executions });
    });
  } finally {
    await agentScope.dispose();
    await processScope.dispose();
  }
}

async function collect(stream: AsyncGenerator<StreamChatEvent>): Promise<StreamChatEvent[]> {
  const events: StreamChatEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function seed(storage: ReturnType<typeof createInMemoryStorageBundle>, sessionId: string) {
  const message = await storage.conversation.createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
  await storage.conversation.createPart({ id: crypto.randomUUID(), messageId: message.id, createdAt: Date.now(), type: 'text', text: 'Original objective' }, sessionId);
  return { sessionId, preconfig, modelId: 'test-model', providerId: 'sandbox', messages: (await storage.conversation.buildEffectiveContextHistory(sessionId)).messages };
}

describe('chat message attribution', () => {
  test('persists executing identity per turn instead of mutable session ownership', async () => {
    await fixture([text('First answer'), text('Second answer')], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      await storage.conversation.updateSession(sessionId, { agentId: 'different-session-owner' });
      const { streamChat } = await import('@/harnesses/prokop/execution/agent');
      const messageIds: string[] = [];
      for (const agentId of ['first-agent', 'second-agent']) {
        const events = await collect(streamChat({ ...options, preconfig: { ...preconfig, id: agentId } }));
        const created = events.find(event => event.type === 'message.created');
        expect(created?.type).toBe('message.created');
        if (created?.type !== 'message.created') throw new Error('Missing assistant creation');
        expect(created.message).toMatchObject({ role: 'assistant', agent: agentId });
        messageIds.push(created.message.id);
        expect(events.some(event => event.type === 'message.updated'
          && event.message.role === 'assistant' && event.message.status === 'completed'
          && event.message.agent === agentId)).toBe(true);
        expect(await storage.conversation.getMessage(created.message.id)).toMatchObject({ agent: agentId, status: 'completed' });
      }
      expect(await storage.conversation.getMessage(messageIds[0]!)).toMatchObject({ agent: 'first-agent' });
      expect(await storage.conversation.getMessage(messageIds[1]!)).toMatchObject({ agent: 'second-agent' });
    });
  });
});

describe('goal cancellation ownership', () => {
  test('interrupting the parent as evaluation starts cancels the goal and clears running state', async () => {
    let parentId = '';
    let interruption: Promise<unknown> | undefined;
    await fixture([text('Done'), text('{"goalMet":true,"reason":"Done"}')], async ({ storage, sessionId, events }) => {
      parentId = sessionId;
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} }, 'test', sessionId, 'Original objective', undefined, undefined, 'Finish', 2);
      await interruption;
      expect(interruption).toBeDefined();
      expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'cancelled', currentTurn: 1 });
      expect((await storage.conversation.getSession(sessionId))?.runningAt).toBeNull();
      expect(interruptManager.isSessionActive(sessionId)).toBe(false);
    }, 0.75, event => {
      if (event.kind === 'session' && event.action === 'created' && event.session.agentName === 'goal-evaluator') {
        expect(interruptManager.isSessionActive(parentId)).toBe(true);
        interruption = interruptManager.interruptSession(parentId, 'user_request');
      }
    });
  });
  test('worker borrows the goal controller without clearing registration or running state', async () => {
    await fixture([text('Done')], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      const controller = interruptManager.registerSession(sessionId);
      await storage.conversation.updateSession(sessionId, { runningAt: 'goal-running' });
      try {
        await collect(streamChatWithRetry({ ...options, retryAbortController: controller }));
        expect(interruptManager.isSessionActive(sessionId)).toBe(true);
        expect((await storage.conversation.getSession(sessionId))?.runningAt).toBe('goal-running');
      } finally {
        interruptManager.unregisterSession(sessionId);
      }
    });
  });

  for (const throws of [false, true]) {
    test(`cancellation during evaluation wins over ${throws ? 'failure' : 'success'}`, async () => {
      const { runGoalLoopWithDeps } = await import('@/harnesses/prokop/goals/loop');
      await fixture([], async ({ storage, sessionId }) => {
        const controller = new AbortController();
        await runGoalLoopWithDeps({
          sessionId, condition: 'Finish', maxTurns: 1, abortSignal: controller.signal,
          runTurn: async () => ({ streamCompleted: true, interrupted: false }),
        }, {
          getSession: id => storage.conversation.getSession(id),
          updateSession: (id, updates) => storage.conversation.updateSession(id, updates),
          broadcastSessionUpdatedDefault: () => {},
          evaluate: async () => {
            controller.abort();
            if (throws) throw new Error('Evaluation aborted');
            return { goalMet: true, reason: 'Done' };
          },
        });
        expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'cancelled' });
      });
    });
  }
});

describe('evaluator checkpoint context', () => {
  test('retains the latest checkpoint outside the recent window and output tails within a bounded prompt', async () => {
    const { evaluateGoalWithDeps } = await import('@/harnesses/prokop/goals/evaluator');
    await fixture([], async ({ storage, sessionId }) => {
      for (let i = 0; i < 24; i++) {
        const message = await storage.conversation.createMessage({
          id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'completed',
          modelId: 'test-model', providerId: 'sandbox', createdAt: i,
          tokens: { prompt: 0, completion: 0 }, cost: 0,
          ...(i < 2 ? { summary: true, mode: 'compaction' as const } : {}),
        });
        await storage.conversation.createPart({
          id: crypto.randomUUID(), messageId: message.id, createdAt: i, type: 'text',
          text: `${i === 0 ? 'OBSOLETE_CHECKPOINT' : i === 1 ? 'LATEST_CHECKPOINT' : 'Progress'} ${'x'.repeat(10000)}`,
        }, sessionId);
        if (i === 23) await storage.conversation.createPart({
          id: crypto.randomUUID(), messageId: message.id, createdAt: i, type: 'tool', name: 'work', callId: 'evidence',
          state: { status: 'completed', input: {}, output: `BUILD_START${'x'.repeat(4000)}BUILD_PASSED`, startedAt: i, completedAt: i },
        }, sessionId);
      }
      await evaluateGoalWithDeps({ sessionId, condition: 'Finish', turn: 1, maxTurns: 1 }, {
        listTranscript: id => storage.conversation.listMessagesWithParts(id),
        orchestrator: { run: async options => {
          expect(options.systemPrompt).toContain('LATEST_CHECKPOINT');
          expect(options.systemPrompt).not.toContain('OBSOLETE_CHECKPOINT');
          expect(options.systemPrompt).toContain('summary claims only, not direct evidence');
          expect(options.systemPrompt).toContain('BUILD_START');
          expect(options.systemPrompt).toContain('BUILD_PASSED');
          expect(options.systemPrompt.length).toBeLessThan(34000);
          return { text: '', json: { goalMet: false }, sessionId: 'eval' };
        } },
      });
    });
  });
});

describe('context accounting', () => {
  test('adds only new model-facing tool results to reported usage', () => {
    const appended: ModelMessage[] = [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'b', toolName: 'work', output: { type: 'text', value: 'x'.repeat(4000) } }] }];
    expect(estimateNextStepTokens({ usage: { inputTokens: 100, outputTokens: 20 }, response: { messages: [
      { role: 'assistant', content: 'old' },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'work', output: { type: 'text', value: 'old'.repeat(9000) } }] },
      { role: 'assistant', content: 'new' }, ...appended,
    ] } })).toBe(120 + estimateMessageTokens(appended));
    expect(estimateNextStepTokens({ usage: { totalTokens: 123 } })).toBe(123);
  });
});

describe('goal and classic shared compaction', () => {
  for (const goal of [false, true]) {
    test(`${goal ? 'goal' : 'classic'} compacts twice between tool steps without replaying the user prompt`, async () => {
      await fixture([work(), text('Checkpoint one: first action finished.'), work(), text('Checkpoint two: both actions finished.'), text('Done.'), text('{"goalMet":true,"reason":"Both actions finished"}')], async ({ storage, sessionId, history, events, executions }) => {
        await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} }, 'test', sessionId, 'Original objective', undefined, undefined, goal ? 'Both actions finished' : undefined, 1);
        expect(executions()).toBe(2);
        const messages = await storage.conversation.listMessagesWithParts(sessionId);
        expect(messages.filter(entry => entry.message.role === 'assistant' && entry.message.summary)).toHaveLength(2);
        expect(messages.filter(entry => entry.message.role === 'user' && entry.parts.some(part => part.type === 'text' && part.text === 'Original objective'))).toHaveLength(1);
        expect(history[2].context.messages.some(message => JSON.stringify(message.content).includes('Checkpoint one'))).toBe(true);
        expect(history[4].context.messages.some(message => JSON.stringify(message.content).includes('Checkpoint two'))).toBe(true);
        expect(events.filter(event => event.kind === 'failure')).toEqual([]);
        expect(events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId)).toHaveLength(1);
        if (goal) expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'met', currentTurn: 1 });
        expect(interruptManager.isSessionActive(sessionId)).toBe(false);
      });
    });
  }

  test('goal mode compacts a final answer without starting another worker turn', async () => {
    await fixture([text('Done'), text('Checkpoint: done'), text('{"goalMet":true,"reason":"Done"}')], async ({ storage, sessionId, history, events }) => {
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} }, 'test', sessionId, 'Original objective', undefined, undefined, 'Finish', 1);
      expect(history).toHaveLength(3);
      expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'met', currentTurn: 1 });
      expect(events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId)).toHaveLength(1);
    }, 0.01);
  });

  test('goal mode recovers a provider context overflow before evaluating completion', async () => {
    await fixture([
      { match: {}, response: { type: 'error', error: 'context window exceeds limit', errorType: 'invalid_request' }, maxUses: 1 },
      text('Checkpoint: continue original objective'), text('Done'), text('{"goalMet":true,"reason":"Done"}'),
    ], async ({ storage, sessionId, events }) => {
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} }, 'test', sessionId, 'Original objective', undefined, undefined, 'Finish', 1);
      expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'met', currentTurn: 1 });
      expect(events.filter(event => event.kind === 'failure')).toEqual([]);
      expect(events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId)).toHaveLength(1);
    });
  });

  test('preserves the step budget across compaction segments', async () => {
    await fixture([work(), text('First checkpoint'), work(), text('Second checkpoint')], async ({ storage, sessionId, history, executions }) => {
      const options = await seed(storage, sessionId);
      const events = await collect(streamChatWithRetry({ ...options, maxSteps: 2 }));
      expect(executions()).toBe(2);
      expect(history).toHaveLength(4);
      expect(events.filter(event => event.type.startsWith('error'))).toEqual([]);
    });
  });

  test('overflow recovery is bounded and never appends a replay message', async () => {
    await fixture([text('Checkpoint')], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      let attempts = 0;
      const stream: StreamChatFn = async function* () {
        attempts++;
        const message = await storage.conversation.createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'error', modelId: 'test-model', providerId: 'sandbox', createdAt: Date.now(), tokens: { prompt: 0, completion: 0 }, cost: 0 });
        yield { type: 'message.updated', message };
        yield { type: 'error.context_overflow', code: 'context_overflow', message: 'Too large' };
      };
      const events = await collect(streamChatWithRetry(options, stream));
      expect(attempts).toBe(2);
      expect(events.filter(event => event.type === 'error.context_overflow')).toHaveLength(1);
      const messages = await storage.conversation.listMessagesWithParts(sessionId);
      expect(messages.filter(entry => entry.parts.some(part => part.type === 'text' && part.text.startsWith('Replay:')))).toHaveLength(0);
    });
  });

  test('does not resume overflow when a tool outcome is still unknown', async () => {
    await fixture([], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      let attempts = 0;
      let compactions = 0;
      const stream: StreamChatFn = async function* () {
        attempts++;
        const message = await storage.conversation.createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'error', modelId: 'test-model', providerId: 'sandbox', createdAt: Date.now(), tokens: { prompt: 0, completion: 0 }, cost: 0 });
        const part = await storage.conversation.createPart({ id: crypto.randomUUID(), messageId: message.id, type: 'tool', name: 'work', callId: 'uncertain', createdAt: Date.now(), state: { status: 'running', input: {}, startedAt: Date.now() } }, sessionId);
        yield { type: 'message.updated', message, continuation: true };
        yield { type: 'part.created', sessionId, part };
        yield { type: 'error.context_overflow', code: 'context_overflow', message: 'Too large' };
      };
      const compact: typeof executeCompaction = async () => {
        compactions++;
        throw new Error('Must not compact');
      };
      const events = await collect(streamChatWithRetry(options, stream, {}, compact));
      expect(attempts).toBe(1);
      expect(compactions).toBe(0);
      expect(events.some(event => event.type === 'part.updated' && event.part.type === 'tool' && event.part.state.status === 'interrupted')).toBe(true);
    });
  });

  test('required compaction failure stops instead of continuing oversized context', async () => {
    await fixture([], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      let attempts = 0;
      const stream: StreamChatFn = async function* () {
        attempts++;
        yield { type: 'needs_compaction', sessionId, resume: true };
      };
      const compact: typeof executeCompaction = async () => ({ ok: false, error: 'Summary failed', skipped: false, reason: 'auto', triggerMessageId: null });
      const events = await collect(streamChatWithRetry(options, stream, {}, compact));
      expect(attempts).toBe(1);
      expect(events).toContainEqual({ type: 'error', code: 'compaction_failed', message: 'Summary failed' });
    });
  });

  test('retries a fresh post-compaction model call without replaying completed tools', async () => {
    await fixture([work(), text('Checkpoint: action completed'), text('Done')], async ({ storage, sessionId, executions }) => {
      const options = await seed(storage, sessionId);
      const { streamChat } = await import('@/harnesses/prokop/execution/agent');
      let attempts = 0;
      const stream: StreamChatFn = async function* (segment) {
        attempts++;
        if (attempts === 2) throw Object.assign(new Error('Temporary outage'), { status: 503 });
        yield* streamChat(segment);
      };
      const events = await collect(streamChatWithRetry(options, stream, { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }));
      expect(attempts).toBe(3);
      expect(executions()).toBe(1);
      expect(events.filter(event => event.type === 'chat.retry' && event.status === 'scheduled')).toHaveLength(1);
      expect(events.filter(event => event.type.startsWith('error'))).toEqual([]);
    });
  });

  test('does not replay the stream if compaction infrastructure throws', async () => {
    await fixture([], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      let attempts = 0;
      const stream: StreamChatFn = async function* () {
        attempts++;
        yield { type: 'needs_compaction', sessionId, resume: true };
      };
      const compact: typeof executeCompaction = async () => { throw Object.assign(new Error('Storage unavailable'), { status: 503 }); };
      const events = await collect(streamChatWithRetry(options, stream, {}, compact));
      expect(attempts).toBe(1);
      expect(events.filter(event => event.type === 'chat.retry' && event.status === 'scheduled')).toHaveLength(0);
      expect(events.some(event => event.type === 'error.server')).toBe(true);
    });
  });

  test('goal compaction failure fails the goal and emits one terminal error', async () => {
    await fixture([work(), { match: {}, response: { type: 'error', error: 'Summary rejected', errorType: 'invalid_request' }, maxUses: 1 }], async ({ storage, sessionId, events, executions }) => {
      await handleChat({ emit: delivery => events.push(delivery.event), attachOriginToSession: () => {} }, 'test', sessionId, 'Original objective', undefined, undefined, 'Finish', 2);
      expect(executions()).toBe(1);
      expect((await storage.conversation.getSession(sessionId))?.metadata?.goal).toMatchObject({ status: 'failed', currentTurn: 1 });
      const terminal = events.filter(event => event.kind === 'terminal' && event.sessionId === sessionId);
      expect(terminal).toHaveLength(1);
      expect(terminal[0]).toMatchObject({ message: { status: 'error' } });
    });
  });

  test('keeps cancellation registered through compaction and does not resume after abort', async () => {
    await fixture([], async ({ storage, sessionId }) => {
      const options = await seed(storage, sessionId);
      let attempts = 0;
      const stream: StreamChatFn = async function* () {
        attempts++;
        const message = await storage.conversation.createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'completed', modelId: 'test-model', providerId: 'sandbox', createdAt: Date.now(), tokens: { prompt: 1, completion: 1 }, cost: 0 });
        yield { type: 'message.updated', message };
        yield { type: 'needs_compaction', sessionId, resume: true };
      };
      const compact: typeof executeCompaction = async (_id, _reason, _broadcast, _update, signal) => {
        expect(interruptManager.isSessionActive(sessionId)).toBe(true);
        expect((await storage.conversation.getSession(sessionId))?.runningAt).toBeTruthy();
        await interruptManager.interruptSession(sessionId, 'user_request');
        expect(signal?.aborted).toBe(true);
        return { ok: false, error: 'Aborted', reason: 'auto', skipped: false, triggerMessageId: null };
      };
      const events = await collect(streamChatWithRetry(options, stream, {}, compact));
      expect(attempts).toBe(1);
      expect(events.some(event => event.type === 'message.updated' && event.message.role === 'assistant' && event.message.status === 'interrupted')).toBe(true);
      expect(interruptManager.isSessionActive(sessionId)).toBe(false);
      expect((await storage.conversation.getSession(sessionId))?.runningAt).toBeNull();
    });
  });
});
