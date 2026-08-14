import { afterEach, describe, expect, test } from 'bun:test';
import { SandboxController, sandboxController } from '../src/sandbox/controller';
import type { LlmCallContext } from '../src/sandbox/types';

function context(overrides: Partial<LlmCallContext> = {}): LlmCallContext {
  return {
    callId: crypto.randomUUID(),
    sessionId: 'session-1',
    depth: 0,
    mode: 'stream',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    modelId: 'sandbox-model',
    providerId: 'sandbox',
    timestamp: Date.now(),
    ...overrides,
  };
}

afterEach(() => sandboxController.reset());

describe('package sandbox controller', () => {
  test('exports one stable singleton', async () => {
    const imported = await import('../src/sandbox/controller');
    expect(imported.sandboxController).toBe(sandboxController);
  });

  test('resolves calls and records completion', async () => {
    const controller = new SandboxController();
    const call = context();
    const waiting = controller.waitForResponse(call);
    controller.respond(call.callId, { type: 'text', content: 'reply' });
    await expect(waiting).resolves.toEqual({ type: 'text', content: 'reply' });
    controller.complete(call.callId);
    expect(controller.getHistory()[0]?.completedAt).toEqual(expect.any(Number));
  });

  test('rejects all pending calls for one session with AbortError', async () => {
    const controller = new SandboxController();
    const call = context();
    const waiting = controller.waitForResponse(call);
    expect(controller.rejectAllPendingForSession('session-1')).toEqual([call.callId]);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('uses a catch-all rule for stream and generate calls', async () => {
    const controller = new SandboxController([{
      match: {},
      response: { type: 'text', content: 'fallback' },
    }]);

    await expect(controller.waitForResponse(context({ mode: 'stream' }))).resolves.toEqual({
      type: 'text',
      content: 'fallback',
    });
    await expect(controller.waitForResponse(context({ mode: 'generate' }))).resolves.toEqual({
      type: 'text',
      content: 'fallback',
    });
  });

  test('preserves auto-responder matching and maxUses', async () => {
    const controller = new SandboxController([{
      match: { mode: 'generate', depth: [1], hasToolResults: true },
      response: { type: 'tool-call', toolName: 'read-file', args: { path: 'a' } },
      maxUses: 1,
    }]);
    const response = await controller.waitForResponse(context({
      mode: 'generate',
      depth: 1,
      messages: [{ role: 'tool', content: [{ type: 'tool-result' }] }],
    }));
    expect(response).toEqual({ type: 'tool-call', toolName: 'read-file', args: { path: 'a' } });
    expect(controller.getAutoResponderRules()).toEqual([]);
  });
});
