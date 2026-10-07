import { describe, expect, test } from 'bun:test';
import { APICallError, jsonSchema, stepCountIs, streamText, tool, wrapLanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createOpenAiResponsesModel } from '@/infrastructure/providers/ai-sdk';
import { codexNetworkRetryMiddleware } from '@/infrastructure/providers/codex-network-retry';

const socketError = () => Object.assign(new TypeError('The socket connection was closed unexpectedly.'), {
  code: 'ECONNRESET',
});
const completed = { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } };
const textFrames = [
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg-1' } },
  { type: 'response.output_text.delta', item_id: 'msg-1', delta: 'Recovered' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg-1' } },
  completed,
];
const encode = (frame: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`);
function response(frames: unknown[]): Response {
  return new Response(new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encode(frame));
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
function brokenResponse(error: unknown = socketError()): Response {
  return new Response(new ReadableStream({ start(controller) { controller.error(error); } }), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function model(fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  return createOpenAiResponsesModel({
    modelId: 'gpt-6-astra', apiKey: 'fake-token',
    fetch: Object.assign(fetch, { preconnect: globalThis.fetch.preconnect }),
  }).model;
}

describe('Codex early network retries', () => {
  test('normalizes the raw early-probe error from the reported SDK stack', async () => {
    const original = socketError();
    const wrapped = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: async () => { throw original; } }),
      middleware: codexNetworkRetryMiddleware,
    });
    try {
      await wrapped.doStream({ prompt: [] });
      throw new Error('Expected probe failure');
    } catch (error: unknown) {
      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error)) throw error;
      expect(error.isRetryable).toBe(true);
      expect(error.cause).toBe(original);
      expect(error.message).toBe(original.message);
    }
  });

  test.each([
    new Error('invalid stream'),
    Object.assign(socketError(), { name: 'AbortError' }),
    new APICallError({ message: 'denied', url: 'https://example.test', requestBodyValues: undefined, isRetryable: false }),
  ])('preserves non-network, abort, and existing API error identity (%s)', async (original) => {
    const wrapped = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: async () => { throw original; } }),
      middleware: codexNetworkRetryMiddleware,
    });
    await expect(wrapped.doStream({ prompt: [] })).rejects.toBe(original);
  });

  test('does not normalize a network failure when the request was aborted', async () => {
    const original = socketError();
    const controller = new AbortController();
    const wrapped = wrapLanguageModel({
      model: new MockLanguageModelV3({ doStream: async () => {
        controller.abort();
        throw original;
      } }),
      middleware: codexNetworkRetryMiddleware,
    });
    await expect(wrapped.doStream({ prompt: [], abortSignal: controller.signal })).rejects.toBe(original);
  });
  test('retries only the failed follow-up request after a completed tool', async () => {
    let calls = 0;
    let executions = 0;
    const bodies: string[] = [];
    const item = { type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'save', arguments: '{}', status: 'completed' };
    const result = streamText({
      model: model(async (_input, init) => {
        bodies.push(String(init?.body));
        calls++;
        if (calls === 1) return response([
          { type: 'response.output_item.added', output_index: 0, item },
          { type: 'response.output_item.done', output_index: 0, item },
          completed,
        ]);
        if (calls === 2) return brokenResponse();
        return response(textFrames);
      }),
      prompt: 'Save once, then summarize.',
      tools: { save: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async () => { executions++; return 'saved'; },
      }) },
      stopWhen: stepCountIs(3),
      maxRetries: 1,
    });
    expect(await result.text).toBe('Recovered');
    expect(executions).toBe(1);
    expect(calls).toBe(3);
    expect(bodies[1]).toBe(bodies[2]);
    expect(bodies[1]).toContain('function_call_output');
    expect(bodies[1]).toContain('saved');
  }, 10000);

  test('recovers a raw doStream reset after a tool without replaying it', async () => {
    let calls = 0;
    let executions = 0;
    const prompts: unknown[] = [];
    const result = streamText({
      model: wrapLanguageModel({
        middleware: codexNetworkRetryMiddleware,
        model: new MockLanguageModelV3({ doStream: async (params) => {
          calls++;
          prompts.push(params.prompt);
          if (calls === 2) throw socketError();
          const firstStep = calls === 1;
          return { stream: new ReadableStream({ start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            if (firstStep) {
              controller.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'save', input: '{}' });
            } else {
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'Recovered' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
            }
            controller.enqueue({
              type: 'finish', finishReason: { unified: firstStep ? 'tool-calls' : 'stop', raw: undefined },
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            });
            controller.close();
          } }) };
        } }),
      }),
      prompt: 'Save once, then summarize.',
      tools: { save: tool({
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async () => { executions++; return 'saved'; },
      }) },
      stopWhen: stepCountIs(3), maxRetries: 1,
    });
    expect(await result.text).toBe('Recovered');
    expect(calls).toBe(3);
    expect(executions).toBe(1);
    expect(prompts[1]).toEqual(prompts[2]);
    expect(JSON.stringify(prompts[2])).toContain('saved');
  }, 10000);

  test('exhausts the configured request retry budget', async () => {
    let calls = 0;
    const result = streamText({
      model: model(async () => { calls++; return brokenResponse(); }),
      prompt: 'Hello', maxRetries: 1, onError: () => {},
    });
    await expect(result.text).rejects.toThrow();
    expect(calls).toBe(2);
  }, 10000);

  test('preserves non-network probe failures', async () => {
    let calls = 0;
    const result = streamText({
      model: model(async () => { calls++; return brokenResponse(new Error('invalid stream')); }),
      prompt: 'Hello', maxRetries: 1, onError: () => {},
    });
    await expect(result.text).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('preserves authentication errors without retry', async () => {
    let calls = 0;
    const result = streamText({
      model: model(async () => {
        calls++;
        return new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 });
      }),
      prompt: 'Hello', maxRetries: 1, onError: () => {},
    });
    await expect(result.text).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('abort cancels the SDK backoff without another request', async () => {
    let calls = 0;
    const controller = new AbortController();
    const result = streamText({
      model: model(async () => { calls++; return brokenResponse(); }),
      prompt: 'Hello', maxRetries: 1, abortSignal: controller.signal, onError: () => {},
    });
    const timer = setTimeout(() => controller.abort(), 50);
    try { await result.consumeStream(); } finally { clearTimeout(timer); }
    expect(calls).toBe(1);
  });

  test('does not retry a socket error after stream handoff', async () => {
    let calls = 0;
    let fail: (() => void) | undefined;
    const result = streamText({
      model: model(async () => {
        calls++;
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encode(textFrames[0]));
            controller.enqueue(encode(textFrames[1]));
            fail = () => controller.error(socketError());
          },
        }), { headers: { 'content-type': 'text/event-stream' } });
      }),
      prompt: 'Hello', maxRetries: 1, onError: () => {},
    });
    const errors: unknown[] = [];
    try {
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') fail?.();
        if (part.type === 'error') errors.push(part.error);
      }
    } catch (error: unknown) {
      errors.push(error);
    }
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
  });
});
