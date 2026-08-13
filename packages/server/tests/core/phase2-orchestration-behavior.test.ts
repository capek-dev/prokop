import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AssistantMessage, Preconfig, ServerMessage } from '@jean2/sdk';
import {
  executeChildSession,
  runOrchestratorSession,
} from '@capekai/core/compat/jean2';
import { handleChat, handleSessionEditMessage, type Jean2RouterContext } from '@/core/chat-handler';
import { executeCompaction } from '@/core/compaction-executor';
import { interruptManager } from '@/core/interrupt';
import { createPreconfig } from '@/core/preconfig';
import { activateSandbox, deactivateSandbox, sandboxController } from '@/sandbox';
import {
  addMessageToQueue,
  createAttachment,
  createMessage,
  createPart,
  createSession,
  getChildSessions,
  getNextQueuedMessage,
  getPartsByMessage,
  getSession,
  listMessagesWithParts,
  listQueuedMessages,
  updateSession,
} from '@/store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

const testPreconfig: Omit<Preconfig, 'id'> & { id: string } = {
  id: 'phase2-test',
  name: 'Phase 2 Test',
  description: 'Focused orchestration tests',
  systemPrompt: 'Answer directly.',
  tools: [],
  model: null,
  provider: null,
  settings: null,
  isDefault: false,
  mode: 'primary',
};

interface TestContext {
  ctx: Jean2RouterContext<object>;
  sent: ServerMessage[];
  broadcastToSession: ServerMessage[];
  ws: object;
}

function createRouterContext(): TestContext {
  const sent: ServerMessage[] = [];
  const broadcastToSession: ServerMessage[] = [];
  const ws = {};
  return {
    ws,
    sent,
    broadcastToSession,
    ctx: {
      send: (_socket, message) => sent.push(message),
      broadcast: () => {},
      broadcastToSession: (_sessionId, message) => broadcastToSession.push(message),
      sendToController: () => {},
      sendToAskTargets: () => {},
      clients: new Map([[ws, { sessionIds: new Set<string>(), missedPings: 0 }]]),
    },
  };
}

function seedConversation(sessionId: string): void {
  createMessage({ id: 'user-1', sessionId, role: 'user', createdAt: 1 });
  createPart({ id: 'user-text-1', messageId: 'user-1', createdAt: 1, type: 'text', text: 'Explain TypeScript.' }, sessionId);
  createMessage({
    id: 'assistant-1',
    sessionId,
    role: 'assistant',
    status: 'completed',
    modelId: 'gpt-4o',
    providerId: 'openai',
    tokens: { prompt: 5, completion: 5 },
    cost: 0,
    createdAt: 2,
    completedAt: 2,
  } as AssistantMessage);
  createPart({ id: 'assistant-text-1', messageId: 'assistant-1', createdAt: 2, type: 'text', text: 'TypeScript adds static types.' }, sessionId);
}

async function waitForPendingCall(): Promise<ReturnType<typeof sandboxController.getPendingCalls>[number]> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pending = sandboxController.getPendingCalls()[0];
    if (pending) return pending;
    await Bun.sleep(1);
  }
  throw new Error('Sandbox call did not become pending');
}

function useSandboxSession(sessionId: string): void {
  updateSession(sessionId, {
    preconfigId: testPreconfig.id,
    title: 'Phase 2 Test Session',
    selectedModel: 'gpt-4o',
    selectedProvider: 'sandbox',
  });
}

function setTextResponses(count: number, content = 'done'): void {
  sandboxController.setAutoResponderRules([{
    match: { mode: 'stream' },
    response: { type: 'text', content },
    maxUses: count,
  }]);
}

function setOverflowAndCompactionFailureRules(): void {
  sandboxController.setAutoResponderRules([
    {
      match: { mode: 'stream' },
      response: {
        type: 'error',
        error: 'maximum context length is 100 tokens',
        errorType: 'invalid_request',
      },
      maxUses: 1,
    },
    {
      match: { mode: 'stream' },
      response: { type: 'error', error: 'compaction failed' },
      maxUses: 1,
    },
  ]);
}

describe.serial('Phase 2 orchestration behavior', () => {
  let sessionId: string;
  let workspaceId: string;

  beforeEach(async () => {
    setupTestDataDir();
    setupTestDatabase();
    ({ sessionId, workspaceId } = seedWorkspaceWithSession());
    await createPreconfig(testPreconfig);
    activateSandbox();
    sandboxController.setAutoResponderRules([]);
    useSandboxSession(sessionId);
  });

  afterEach(() => {
    interruptManager.unregisterSession(sessionId);
    deactivateSandbox();
    resetTestDatabase();
    resetTestDataDir();
  });

  test('persists and broadcasts interrupted orchestrator status after abort failure', async () => {
    const abortController = new AbortController();
    const updatedStatuses: Array<string | null | undefined> = [];
    const run = runOrchestratorSession({
      parentSessionId: sessionId,
      title: 'Cancelled orchestrator',
      agentName: 'orchestrator',
      systemPrompt: 'Work',
      userPrompt: 'Work',
      abortSignal: abortController.signal,
      broadcast: () => {},
      broadcastSessionCreated: () => {},
      broadcastSessionUpdated: (session) => updatedStatuses.push(session.subagentStatus),
    });

    await waitForPendingCall();
    abortController.abort();
    let thrown: unknown;
    try {
      await run;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const child = getChildSessions(sessionId)[0];
    expect(child?.subagentStatus).toBe('interrupted');
    expect(updatedStatuses).toEqual(['interrupted']);
  });

  test('drains queued messages in FIFO order and passes queued attachments into the next turn', async () => {
    const attachment = createAttachment({
      sessionId,
      workspaceId,
      filename: 'queued.png',
      mimeType: 'image/png',
      sizeBytes: 3,
      data: new Uint8Array([1, 2, 3]).buffer,
    });
    addMessageToQueue(sessionId, 'second', [{ id: attachment.id, kind: 'image' }]);
    addMessageToQueue(sessionId, 'third');
    setTextResponses(3);
    const router = createRouterContext();

    await handleChat(router.ctx, router.ws, sessionId, 'first');

    const userEntries = listMessagesWithParts(sessionId).filter(({ message }) => message.role === 'user');
    expect(userEntries.map(({ parts }) => parts.find((part) => part.type === 'text')?.text)).toEqual([
      'first',
      'second',
      'third',
    ]);
    const queuedAttachmentParts = userEntries[1].parts.filter((part) => part.type === 'image');
    expect(queuedAttachmentParts).toMatchObject([{
      type: 'image',
      mimeType: 'image/png',
      url: `/api/sessions/${sessionId}/attachments/${attachment.id}/content?key=${attachment.accessKey}`,
    }]);
    expect(router.broadcastToSession.filter((message) => message.type === 'queue.sending')).toHaveLength(2);
    expect(listQueuedMessages(sessionId)).toHaveLength(0);
  });

  test('keeps queued follow-ups pending when the current turn is interrupted', async () => {
    addMessageToQueue(sessionId, 'must remain queued');
    const router = createRouterContext();
    const run = handleChat(router.ctx, router.ws, sessionId, 'first');

    await waitForPendingCall();
    await interruptManager.interruptSession(sessionId, 'user_request');
    await run;

    expect(getNextQueuedMessage(sessionId)?.content).toBe('must remain queued');
    expect(sandboxController.getHistory()).toHaveLength(1);
    expect(router.broadcastToSession.some((message) => message.type === 'queue.sending')).toBe(false);
  });

  test('edits a user message, reverts later messages, and reruns without duplicating the user turn', async () => {
    createMessage({ id: 'editable-user', sessionId, role: 'user', createdAt: 1 });
    createPart({ id: 'editable-text', messageId: 'editable-user', createdAt: 1, type: 'text', text: 'old text' }, sessionId);
    createMessage({
      id: 'old-assistant',
      sessionId,
      role: 'assistant',
      status: 'completed',
      modelId: 'gpt-4o',
      providerId: 'sandbox',
      tokens: { prompt: 1, completion: 1 },
      cost: 0,
      createdAt: 2,
      completedAt: 2,
    } as AssistantMessage);
    createPart({ id: 'old-assistant-text', messageId: 'old-assistant', createdAt: 2, type: 'text', text: 'old answer' }, sessionId);
    setTextResponses(1, 'new answer');
    const router = createRouterContext();

    await handleSessionEditMessage(router.ctx, router.ws, {
      sessionId,
      messageId: 'editable-user',
      content: 'new text',
    });

    const messages = listMessagesWithParts(sessionId);
    expect(messages.filter(({ message }) => message.role === 'user')).toHaveLength(1);
    expect(getPartsByMessage('editable-user')).toMatchObject([{ type: 'text', text: 'new text' }]);
    expect(messages.some(({ message }) => message.id === 'old-assistant')).toBe(false);
    expect(messages.some(({ message }) => message.role === 'assistant' && message.status === 'completed')).toBe(true);
    expect(router.broadcastToSession.some((message) => message.type === 'part.updated')).toBe(true);
    expect(router.broadcastToSession.some((message) => message.type === 'session.state')).toBe(true);
  });

  test('stops retrying overflow compaction after two consecutive failures', async () => {
    seedConversation(sessionId);
    const router = createRouterContext();

    for (let attempt = 0; attempt < 2; attempt++) {
      setOverflowAndCompactionFailureRules();
      await handleChat(router.ctx, router.ws, sessionId, `overflow-${attempt}`);
    }
    const callsAfterFailures = sandboxController.getHistory().length;

    sandboxController.setAutoResponderRules([{
      match: { mode: 'stream' },
      response: {
        type: 'error',
        error: 'maximum context length is 100 tokens',
        errorType: 'invalid_request',
      },
      maxUses: 1,
    }]);
    await handleChat(router.ctx, router.ws, sessionId, 'overflow-cooldown');

    expect(callsAfterFailures).toBe(4);
    expect(sandboxController.getHistory()).toHaveLength(5);
    expect(router.sent.at(-1)).toMatchObject({ type: 'error', code: 'context_overflow' });
    const failedCompactions = listMessagesWithParts(sessionId).filter(
      ({ message }) => message.role === 'assistant' && message.mode === 'compact_failed',
    );
    expect(failedCompactions).toHaveLength(2);
  });

  test('intercepts executeChildSession through the sandbox model path', async () => {
    const child = createSession({
      id: 'sandbox-child',
      workspaceId,
      preconfigId: testPreconfig.id,
      title: 'Sandbox Child',
      status: 'active',
      metadata: null,
      parentId: sessionId,
      agentName: 'phase2-test',
      subagentStatus: 'running',
      selectedModel: 'gpt-4o',
      selectedProvider: 'sandbox',
    });
    setTextResponses(1, 'child sandbox answer');

    const result = await executeChildSession({
      parentSessionId: sessionId,
      childSessionId: child.id,
      preconfig: testPreconfig,
      prompt: 'child work',
      broadcast: () => {},
      broadcastToSession: () => {},
    });

    expect(result.error).toBeUndefined();
    expect(result.parts.find((part) => part.type === 'text')).toMatchObject({
      type: 'text',
      text: 'child sandbox answer',
    });
    expect(sandboxController.getHistory()[0]?.context).toMatchObject({
      sessionId: child.id,
      depth: 1,
      mode: 'stream',
      providerId: 'sandbox',
    });
  });

  test('intercepts executeCompaction through the sandbox model path', async () => {
    seedConversation(sessionId);
    setTextResponses(1, '## Summary\n\nSandbox compacted summary.');

    const result = await executeCompaction(sessionId, 'manual', () => {}, () => {});

    expect(result.ok).toBe(true);
    expect(sandboxController.getHistory()[0]?.context).toMatchObject({
      sessionId,
      depth: 0,
      mode: 'stream',
      providerId: 'sandbox',
    });
    const summary = listMessagesWithParts(sessionId).find(
      ({ message }) => message.role === 'assistant' && message.summary === true,
    );
    expect(summary?.message.role === 'assistant' ? summary.message.mode : undefined).toBe('compaction');
    expect(summary?.parts.find((part) => part.type === 'text')).toMatchObject({
      text: '## Summary\n\nSandbox compacted summary.',
    });
    expect(getSession(sessionId)).toMatchObject({ compacting: false, promptTokens: 10, completionTokens: 20 });
  });
});
