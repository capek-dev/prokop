import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import type { MessageWithParts, ResponseFormat } from '@prokopai/sdk/types';
import { createSingleModelConfiguration } from '@/infrastructure/providers/configuration/single-model';
import { withRuntimeConfiguration } from '@/infrastructure/providers/configuration/runtime';
import { createProtocolModel } from '@/infrastructure/providers/protocol-model';
import { withProviderOverrides } from '@/infrastructure/providers/registry';
import type { ConnectableProvider } from '@/infrastructure/providers/types';
import { getModelWithMetadata } from '@/infrastructure/providers/model-resolution';
import { buildStreamConfig } from '@/harnesses/prokop/execution/stream/stream-config';
import { convertToAiSdkMessages } from '@/harnesses/prokop/execution/message-utils';

const format: ResponseFormat = {
  id: 'fixture', name: 'fixture', createdAt: 1, updatedAt: 1,
  schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
};
const base = { modelId: 'fixture', variant: 'test', systemMessage: 'Be concise.', baseProviderOptions: undefined };

describe('core shared protocol adapters', () => {
  for (const providerId of ['minimax', 'zhipu', 'zhipu-coding'] as const) {
    for (const thinking of ['disabled', 'adaptive'] as const) {
      test(`${providerId}: serializes variants and persisted tools (${thinking})`, async () => {
        const configuration = createSingleModelConfiguration({ providerId, modelId: 'fixture' });
        await withProviderOverrides(new Map(), () => withRuntimeConfiguration({
          ...configuration,
          getApiKey: () => 'fixture-key',
          findModelVariant: () => providerId === 'minimax'
            ? { thinking: { type: thinking } }
            : { reasoningEffort: 'max', thinking: { type: 'disabled' } },
        }, async () => {
          const resolved = await getModelWithMetadata({ providerId, modelId: 'fixture' });
          expect(typeof resolved.model === 'object' && resolved.model.specificationVersion).toBe('v3');
          const config = buildStreamConfig({ ...base, providerId });
          const history = await convertToAiSdkMessages([{
            message: { id: 'a', sessionId: 's', role: 'assistant', createdAt: 1, status: 'completed', modelId: 'fixture', providerId, tokens: { prompt: 1, completion: 1 }, cost: 0 },
            parts: [
              { id: 'r', messageId: 'a', type: 'reasoning', text: 'stored reasoning', createdAt: 1 },
              { id: 't', messageId: 'a', type: 'tool', callId: 'call_1', name: 'echo', createdAt: 1,
                state: { status: 'completed', input: { text: 'hello' }, output: { text: 'hello' }, startedAt: 1, completedAt: 2 } },
            ],
          } satisfies MessageWithParts]);
          expect(JSON.stringify(history)).not.toContain('stored reasoning');
          let body: Record<string, unknown> = {};
          const fetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
            body = JSON.parse(String(init?.body));
            const expected = providerId === 'minimax' ? 'https://api.minimax.io/anthropic/v1/messages'
              : providerId === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
                : 'https://api.z.ai/api/coding/paas/v4/chat/completions';
            expect(String(url)).toBe(expected);
            expect(new Headers(init?.headers).get(providerId === 'minimax' ? 'x-api-key' : 'authorization'))
              .toBe(providerId === 'minimax' ? 'fixture-key' : 'Bearer fixture-key');
            return Response.json(providerId === 'minimax' ? {
              id: 'msg_1', type: 'message', role: 'assistant', model: 'fixture',
              content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn', stop_sequence: null,
              usage: { input_tokens: 4, output_tokens: 1 },
            } : {
              id: 'chat_1', created: 1, model: 'fixture',
              choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
            });
          }, { preconnect: () => {} });
          const result = await generateText({
            model: createProtocolModel(providerId, 'fixture', 'fixture-key', fetch),
            messages: history,
            providerOptions: config.providerOptions as Parameters<typeof generateText>[0]['providerOptions'],
            maxOutputTokens: 512, maxRetries: 0,
          });
          expect(result.text).toBe('hello');
          expect(body.model).toBe('fixture');
          expect(body.thinking).toEqual({ type: providerId === 'minimax' ? thinking : 'disabled' });
          if (providerId !== 'minimax') expect(body.reasoning_effort).toBe('max');
          expect(JSON.stringify(body.messages)).toContain(providerId === 'minimax' ? 'tool_result' : 'tool_call_id');
          expect(body).not.toHaveProperty('response_format');
        }));
      });
    }

    test(`${providerId}: retains prompt/native model selection`, () => {
      const configuration = createSingleModelConfiguration({ providerId, modelId: 'fixture' });
      for (const mode of ['prompt', 'native'] as const) {
        withRuntimeConfiguration({
          ...configuration,
          findModel: () => ({ ...configuration.findModel('fixture')!, capabilities: { structuredOutput: { mode } } }),
        }, () => {
          const result = buildStreamConfig({ ...base, providerId, responseFormat: format });
          expect(result.usePromptBasedStructuredOutput).toBe(mode === 'prompt');
          expect(Boolean(result.streamOutput)).toBe(mode === 'native');
          expect(result.systemMessage.includes('JSON Schema:')).toBe(mode === 'prompt');
        });
      }
    });
  }

  test('registered MiniMax overrides retain their option namespace', () => {
    const provider: ConnectableProvider = {
      descriptor: { id: 'minimax', displayName: 'Custom', authType: 'none', connectable: false },
      getStatus: () => ({ provider: 'minimax', connected: true }),
      connect: async () => ({}), disconnect: async () => {}, onTokensReceived: async () => {},
    };
    const configuration = createSingleModelConfiguration({ providerId: 'minimax', modelId: 'fixture' });
    withRuntimeConfiguration({ ...configuration, findModelVariant: () => ({ custom: true }) }, () => {
      withProviderOverrides(new Map([['minimax', provider]]), () => {
        expect(buildStreamConfig({ ...base, providerId: undefined }).providerOptions).toEqual({ minimax: { custom: true } });
        provider.descriptor.providerOptionsKey = 'custom';
        expect(buildStreamConfig({ ...base, providerId: 'minimax' }).providerOptions).toEqual({ custom: { custom: true } });
      });
    });
  });
});
