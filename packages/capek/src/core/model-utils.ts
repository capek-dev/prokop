import { type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { findProviderFromModel, getApiKeyForProvider } from './provider-utils';
import {
  createModelForProvider,
  findModel,
  getLLMBaseUrl,
  getProvider,
  isSandboxActive,
} from '../compat/jean2-dependencies';

export interface ModelWithMetadata {
  model: LanguageModel;
  useProviderInstructions?: boolean;
  omitMaxOutputTokens?: boolean;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface ModelResolutionOptions {
  modelId?: string;
  providerId?: string;
  systemPrompt?: string;
  sessionId?: string;
}

export async function getModelWithMetadata(options: ModelResolutionOptions): Promise<ModelWithMetadata>;
export async function getModelWithMetadata(modelId?: string, providerId?: string, systemPrompt?: string): Promise<ModelWithMetadata>;
export async function getModelWithMetadata(
  modelIdOrOptions?: string | ModelResolutionOptions,
  providerId?: string,
  systemPrompt?: string,
): Promise<ModelWithMetadata> {
  const options: ModelResolutionOptions = typeof modelIdOrOptions === 'string'
    ? { modelId: modelIdOrOptions, providerId, systemPrompt }
    : (modelIdOrOptions ?? {});
  const defaultModelId = 'gpt-4o';
  const resolvedModelId = options.modelId || defaultModelId;

  // When sandbox mode is active, route all LLM calls through the sandbox provider
  if (isSandboxActive()) {
    const sandboxProvider = getProvider('sandbox');
    if (sandboxProvider) {
      const result = await createModelForProvider({
        modelId: resolvedModelId,
        providerId: 'sandbox',
        systemPrompt: options.systemPrompt || '',
        sessionId: options.sessionId,
      });
      return {
        model: result.model,
        useProviderInstructions: result.useProviderInstructions,
        omitMaxOutputTokens: result.omitMaxOutputTokens,
        providerOptions: result.providerOptions,
      };
    }
  }

  let provider = options.providerId;
  let model = resolvedModelId;

  if (!provider) {
    provider = findProviderFromModel(resolvedModelId);
    const modelInfo = findModel(resolvedModelId);
    if (modelInfo) {
      model = modelInfo.id;
    }
  }

  const registeredProvider = provider ? getProvider(provider) : undefined;
  if (registeredProvider) {
    const result = await createModelForProvider({
      modelId: model,
      providerId: provider,
      systemPrompt: options.systemPrompt || '',
      sessionId: options.sessionId,
    });
    return {
      model: result.model,
      useProviderInstructions: result.useProviderInstructions,
      omitMaxOutputTokens: result.omitMaxOutputTokens,
      providerOptions: result.providerOptions,
    };
  }

  const apiKey = getApiKeyForProvider(provider);

  if (!apiKey) {
    throw new Error(`No API key configured for provider: ${provider}. Set LLM_${provider.toUpperCase()}_API_KEY environment variable.`);
  }

  switch (provider) {
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      const openrouter = createOpenRouter({ apiKey });
      return { model: openrouter.chat(model) as unknown as LanguageModel };
    }

    case 'minimax': {
      const { createMinimax } = await import('vercel-minimax-ai-provider');
      const minimax = createMinimax({ apiKey });
      return { model: minimax.chat(model) as unknown as LanguageModel };
    }

    case 'zhipu': {
      const { createZhipu } = await import('zhipu-ai-provider');
      const zhipu = createZhipu({
        apiKey,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      });
      return { model: zhipu.chat(model) as unknown as LanguageModel };
    }

    case 'zhipu-coding': {
      const { createZhipu } = await import('zhipu-ai-provider');
      const zhipu = createZhipu({
        apiKey,
        baseURL: 'https://api.z.ai/api/coding/paas/v4',
      });
      return { model: zhipu.chat(model) as unknown as LanguageModel };
    }

    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      const deepseek = createDeepSeek({ apiKey });
      return { model: deepseek.chat(model) as unknown as LanguageModel };
    }

    case 'openai':
    default: {
      const openai = createOpenAI({
        apiKey,
        baseURL: getLLMBaseUrl() || undefined,
      });
      return {
        model: openai.responses(model) as unknown as LanguageModel,
        providerOptions: {
          openai: {
            promptCacheKey: options.sessionId,
            store: false,
          },
        },
      };
    }
  }
}

export async function getModel(modelId?: string, providerId?: string): Promise<LanguageModel> {
  const { model } = await getModelWithMetadata({ modelId, providerId });
  return model;
}
