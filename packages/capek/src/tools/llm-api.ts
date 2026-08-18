import { streamText, streamObject } from 'ai';
import { jsonSchema } from 'ai';
import type { ModelMessage } from 'ai';
import type { LlmApi } from '@capekai/tool'
import { LlmTextOptions, LlmStructuredOptions, LlmImage } from '@capekai/tool';
import { getModelWithMetadata } from '../core/model-utils';

export function createLlmApi(defaultModelId?: string, defaultProviderId?: string, sessionId?: string): LlmApi {
  return {
    async generateText(options: LlmTextOptions): Promise<string> {
      const { model, omitMaxOutputTokens, providerOptions, useProviderInstructions } = await getModelWithMetadata({
        modelId: options.model || defaultModelId,
        providerId: options.provider || defaultProviderId,
        systemPrompt: options.system,
        sessionId,
      });

      let userContent: string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string | Uint8Array; mimeType: string }> = options.prompt;

      if (options.image) {
        const images: LlmImage[] = Array.isArray(options.image) ? options.image : [options.image];
        userContent = [
          { type: 'text', text: options.prompt },
          ...images.map((img) => ({
            type: 'image' as const,
            image: img.data,
            mimeType: img.mediaType,
          })),
        ];
      }

      const stream = streamText({
        model,
        system: (!options.system || useProviderInstructions) ? undefined : options.system,
        messages: [{ role: 'user' as const, content: userContent }] as ModelMessage[],
        maxOutputTokens: omitMaxOutputTokens ? undefined : (options.maxTokens ?? 4096),
        providerOptions: providerOptions as unknown as Parameters<typeof streamText>[0]['providerOptions'],
      });

      return stream.text;
    },

    async generateStructured<T = unknown>(options: LlmStructuredOptions): Promise<T> {
      const { model, omitMaxOutputTokens, providerOptions, useProviderInstructions } = await getModelWithMetadata({
        modelId: options.model || defaultModelId,
        providerId: options.provider || defaultProviderId,
        systemPrompt: options.system,
        sessionId,
      });

      let userContent: string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string | Uint8Array; mimeType: string }> = options.prompt;

      if (options.image) {
        const images: LlmImage[] = Array.isArray(options.image) ? options.image : [options.image];
        userContent = [
          { type: 'text', text: options.prompt },
          ...images.map((img) => ({
            type: 'image' as const,
            image: img.data,
            mimeType: img.mediaType,
          })),
        ];
      }

      const result = streamObject({
        model,
        system: (!options.system || useProviderInstructions) ? undefined : options.system,
        messages: [{ role: 'user' as const, content: userContent }] as ModelMessage[],
        schema: jsonSchema(options.schema),
        maxOutputTokens: omitMaxOutputTokens ? undefined : (options.maxTokens ?? 4096),
        providerOptions: providerOptions as unknown as Parameters<typeof streamObject>[0]['providerOptions'],
      });

      return result.object as Promise<T>;
    },
  };
}
