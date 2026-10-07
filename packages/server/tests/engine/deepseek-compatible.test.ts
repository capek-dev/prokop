import { describe, expect, test } from 'bun:test';
import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai';
import type { AssistantMessage, MessageWithParts } from '@prokopai/sdk/types';
import { createProtocolModel } from '@/infrastructure/providers/protocol-model';
import { convertToAiSdkMessages } from '@/harnesses/prokop/execution/message-utils';
import { getModelWithMetadata } from '@/infrastructure/providers/model-resolution';
import { createSingleModelConfiguration } from '@/infrastructure/providers/configuration/single-model';
import { withRuntimeConfiguration } from '@/infrastructure/providers/configuration/runtime';
import { withProviderOverrides } from '@/infrastructure/providers/registry';
import { buildStreamConfig } from '@/harnesses/prokop/execution/stream/stream-config';

function stored(reasoning?: string, mode?: AssistantMessage['mode']): MessageWithParts {
  return {
    message: { id: 'a', sessionId: 's', role: 'assistant', status: 'completed', modelId: 'deepseek-reasoner', providerId: 'deepseek', createdAt: 1, tokens: { prompt: 1, completion: 1 }, cost: 0, mode },
    parts: [
      ...(reasoning === undefined ? [] : [{ id: 'r', messageId: 'a', createdAt: 1, type: 'reasoning' as const, text: reasoning }]),
      { id: 't', messageId: 'a', createdAt: 1, type: 'tool', callId: 'call_1', name: 'echo', state: { status: 'completed', input: { text: 'probe' }, output: { text: 'probe' }, startedAt: 1, completedAt: 2 } },
    ],
  };
}
function mockFetch(fn: (...args: Parameters<typeof fetch>) => Promise<Response>): typeof fetch {
  return Object.assign(fn, { preconnect: () => {} });
}
function streamResponse(reasoning: string | undefined, toolCall: boolean): Response {
  const deltas = toolCall ? [
    ...(reasoning === undefined ? [] : [{ reasoning_content: reasoning }]),
    { tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'echo', arguments: '{"text":"probe"}' } }] },
  ] : [{ content: 'done' }];
  const chunks: object[] = deltas.map((delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] }));
  chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }] });
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

describe('DeepSeek compatible reasoning replay', () => {
  for (const reasoning of ['Think first.', '', undefined]) {
    test(`persisted history serializes reasoning ${JSON.stringify(reasoning)}`, async () => {
      const history = await convertToAiSdkMessages([stored(reasoning)], undefined, { replayReasoning: true });
      let called = false;
      const model = createProtocolModel('deepseek', 'deepseek-reasoner', 'fixture-key', mockFetch(async (url, init) => {
        called = true;
        expect(String(url)).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-key');
        const body = JSON.parse(String(init?.body));
        expect(body.messages[0].reasoning_content).toBe(reasoning ?? '');
        expect(JSON.stringify(body.messages[0].content)).not.toContain('Think first.');
        expect(body.messages[0].tool_calls[0].id).toBe('call_1');
        expect(body.messages[1].tool_call_id).toBe('call_1');
        expect(body.reasoning_effort).toBe('high');
        expect(body.thinking).toEqual({ type: 'enabled' });
        return Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }] });
      }));
      const configuration = createSingleModelConfiguration({ providerId: 'deepseek', modelId: 'deepseek-reasoner' });
      await withRuntimeConfiguration({ ...configuration, findModelVariant: () => ({ reasoningEffort: 'high', thinking: { type: 'enabled' } }) }, async () => {
        const config = buildStreamConfig({ modelId: 'deepseek-reasoner', providerId: 'deepseek', variant: 'high', systemMessage: 'test', baseProviderOptions: undefined });
        await generateText({ model, messages: history, maxRetries: 0, providerOptions: config.providerOptions as Parameters<typeof generateText>[0]['providerOptions'] });
      });
      expect(called).toBe(true);
    });

    test(`SDK auto tool continuation serializes reasoning ${JSON.stringify(reasoning)}`, async () => {
      let calls = 0;
      const model = createProtocolModel('deepseek', 'deepseek-reasoner', 'fixture-key', mockFetch(async (_url, init) => {
        calls++;
        if (calls === 2) {
          const body = JSON.parse(String(init?.body));
          expect(body.messages.find((message: { role: string }) => message.role === 'assistant').reasoning_content).toBe(reasoning ?? '');
          expect(body.messages.find((message: { role: string }) => message.role === 'tool').tool_call_id).toBe('call_2');
        }
        if (calls > 2) throw new Error('Unexpected retry');
        return streamResponse(reasoning, calls === 1);
      }));
      const result = streamText({ model, prompt: 'Use echo', maxRetries: 0, stopWhen: stepCountIs(2), onError: () => {}, tools: {
        echo: tool({ inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }), execute: async (input) => input }),
      } });
      expect(await result.text).toBe('done');
      expect(calls).toBe(2);
    });
  }

  test('text history keeps reasoning separate and does not annotate user messages', async () => {
    const assistant = stored('first');
    assistant.parts = [
      { id: 'r1', messageId: 'a', createdAt: 1, type: 'reasoning', text: 'first' },
      { id: 'r2', messageId: 'a', createdAt: 1, type: 'reasoning', text: ' second' },
      { id: 'text', messageId: 'a', createdAt: 1, type: 'text', text: 'answer' },
    ];
    const history = await convertToAiSdkMessages([
      { message: { id: 'u', sessionId: 's', role: 'user', createdAt: 1 }, parts: [{ id: 'ut', messageId: 'u', createdAt: 1, type: 'text', text: 'question' }] },
      assistant,
    ], undefined, { replayReasoning: true });
    expect(history[0]).toEqual({ role: 'user', content: 'question' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'answer', providerOptions: { openaiCompatible: { reasoning_content: 'first second' } } });
  });

  test('HTTP failures propagate without retrying', async () => {
    let calls = 0;
    const model = createProtocolModel('deepseek', 'deepseek-chat', 'fixture-key', mockFetch(async () => {
      calls++;
      return Response.json({ error: { message: 'Fixture rejected', type: 'authentication_error' } }, { status: 401 });
    }));
    await expect(generateText({ model, prompt: 'Hello', maxRetries: 0 })).rejects.toThrow('Fixture rejected');
    expect(calls).toBe(1);
  });

  test('replay is opt-in and failed turns remain excluded', async () => {
    expect(JSON.stringify(await convertToAiSdkMessages([stored('secret reasoning')]))).not.toContain('secret reasoning');
    expect(await convertToAiSdkMessages([stored('failed', 'retry_failed'), stored('failed', 'compact_failed')], undefined, { replayReasoning: true })).toEqual([]);
  });

  test('built-in resolution enables replay, other providers and overrides do not', async () => {
    const configuration = createSingleModelConfiguration({ providerId: 'deepseek', modelId: 'deepseek-reasoner' });
    await withRuntimeConfiguration({ ...configuration, getApiKey: () => 'fixture-key' }, () => withProviderOverrides(new Map(), async () => {
      expect((await getModelWithMetadata()).replayReasoning).toBe(true);
      expect((await getModelWithMetadata({ providerId: 'zhipu', modelId: 'glm' })).replayReasoning).toBeUndefined();
      await withProviderOverrides(new Map([['deepseek', {
        descriptor: { id: 'deepseek', displayName: 'Override', authType: 'none', connectable: false },
        getStatus: () => ({ provider: 'deepseek', connected: true }),
        connect: async () => ({}), disconnect: async () => {}, onTokensReceived: async () => {},
        createModel: async () => ({ model: createProtocolModel('zhipu', 'fixture', 'fixture-key') }),
      }]]), async () => {
        expect((await getModelWithMetadata()).replayReasoning).toBeUndefined();
      });
    }));
  });
});
