import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SandboxController, type LlmCallContext } from '@capekai/core/sandbox';

function createContext(overrides: Partial<LlmCallContext> = {}): LlmCallContext {
  return {
    callId: crypto.randomUUID(),
    sessionId: 'session-1',
    depth: 0,
    mode: 'stream',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
    tools: [],
    modelId: 'sandbox-model',
    providerId: 'sandbox',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SandboxController', () => {
  let controller: SandboxController;

  beforeEach(() => {
    controller = new SandboxController();
  });

  afterEach(() => {
    controller.reset();
  });

  test('respond() resolves a waiting call and stores history', async () => {
    const context = createContext();
    const responsePromise = controller.waitForResponse(context);

    expect(controller.getPendingCalls()).toHaveLength(1);
    expect(controller.getHistory()).toHaveLength(1);
    expect(controller.getHistory()[0]?.response).toBeNull();

    controller.respond(context.callId, {
      type: 'text',
      content: 'sandbox reply',
    });

    await expect(responsePromise).resolves.toEqual({
      type: 'text',
      content: 'sandbox reply',
    });

    expect(controller.getPendingCalls()).toHaveLength(0);
    expect(controller.getHistory()[0]?.response).toEqual({
      type: 'text',
      content: 'sandbox reply',
    });
    expect(controller.getHistory()[0]?.respondedAt).toEqual(expect.any(Number));
  });

  test('complete() updates completedAt in history', async () => {
    const context = createContext();
    const responsePromise = controller.waitForResponse(context);

    controller.respond(context.callId, {
      type: 'text',
      content: 'done',
    });
    await responsePromise;

    controller.complete(context.callId);

    expect(controller.getHistory()[0]?.completedAt).toEqual(expect.any(Number));
  });

  test('auto-responder matches by mode, depth, sessionId, and tool results', async () => {
    controller.setAutoResponderRules([
      {
        label: 'tool-result follow-up',
        match: {
          mode: 'stream',
          depth: [1, 2],
          sessionId: 'child-session',
          hasToolResults: true,
        },
        response: {
          type: 'reasoning',
          reasoning: 'thinking',
          text: 'final answer',
        },
      },
    ]);

    const response = await controller.waitForResponse(createContext({
      sessionId: 'child-session',
      depth: 1,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              toolName: 'read-file',
              result: 'file contents',
            },
          ],
        },
      ],
    }));

    expect(response).toEqual({
      type: 'reasoning',
      reasoning: 'thinking',
      text: 'final answer',
    });
    expect(controller.getPendingCalls()).toHaveLength(0);
    expect(controller.getHistory()).toHaveLength(1);
    expect(controller.getHistory()[0]?.respondedAt).toEqual(expect.any(Number));
  });

  test('auto-responder maxUses removes rule after it is consumed', async () => {
    controller.setAutoResponderRules([
      {
        match: { mode: 'generate' },
        response: { type: 'text', content: 'auto summary' },
        maxUses: 1,
      },
    ]);

    const firstResponse = await controller.waitForResponse(createContext({ mode: 'generate' }));
    expect(firstResponse).toEqual({ type: 'text', content: 'auto summary' });
    expect(controller.getAutoResponderRules()).toHaveLength(0);

    const secondContext = createContext({ mode: 'generate' });
    const secondResponsePromise = controller.waitForResponse(secondContext);

    expect(controller.getPendingCall(secondContext.callId)).toEqual(secondContext);

    controller.respond(secondContext.callId, { type: 'text', content: 'manual summary' });
    await expect(secondResponsePromise).resolves.toEqual({
      type: 'text',
      content: 'manual summary',
    });
  });
});
