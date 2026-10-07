import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { wrapLanguageModel, type LanguageModel } from 'ai';

export type ProtocolProvider = 'minimax' | 'zhipu' | 'zhipu-coding' | 'deepseek';

export function createProtocolModel(
  providerId: ProtocolProvider,
  modelId: string,
  apiKey: string,
  fetch?: NonNullable<Parameters<typeof createAnthropic>[0]>['fetch'],
): LanguageModel {
  if (providerId === 'minimax') {
    return createAnthropic({ apiKey, baseURL: 'https://api.minimax.io/anthropic/v1', fetch })(modelId);
  }
  const model = createOpenAICompatible({
    name: providerId,
    apiKey,
    baseURL: providerId === 'deepseek' ? 'https://api.deepseek.com/v1' : providerId === 'zhipu'
      ? 'https://open.bigmodel.cn/api/paas/v4'
      : 'https://api.z.ai/api/coding/paas/v4',
    fetch,
  })(modelId);
  if (providerId !== 'deepseek') return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        prompt: params.prompt.map((message) => {
          if (message.role !== 'assistant') return message;
          const reasoning = message.content.filter((part) => part.type === 'reasoning');
          const existing = message.providerOptions?.openaiCompatible?.reasoning_content;
          return {
            ...message,
            content: message.content.filter((part) => part.type !== 'reasoning'),
            providerOptions: {
              ...message.providerOptions,
              openaiCompatible: {
                ...message.providerOptions?.openaiCompatible,
                // The SDK omits empty reasoning by default. DeepSeek needs the field
                // on tool continuations too, including SDK-generated assistant steps.
                reasoning_content: reasoning.length > 0
                  ? reasoning.map((part) => part.text).join('')
                  : typeof existing === 'string' ? existing : '',
              },
            },
          };
        }),
      }),
    },
  });
}
