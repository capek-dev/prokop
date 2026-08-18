import { type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { findProviderFromModel, parseModelSpecifier } from './provider-utils';
import { findModel, getApiKeyForProvider, getLLMBaseUrl, getModelsConfig } from '../configuration/runtime';
import { createModelForProvider, getProvider } from '../providers/registry';
import { isSandboxActive } from '../runtime/host-dependencies';

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
  const requestedModelId = options.modelId || getModelsConfig().defaultModel;
  const parsedSpecifier = parseModelSpecifier(requestedModelId);
  const resolvedModelId = parsedSpecifier.modelId;
  const sandboxProvider = getProvider('sandbox');

  // When sandbox mode is active, route all LLM calls through the sandbox provider
  if (sandboxProvider && isSandboxActive()) {
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

  let provider = options.providerId ?? parsedSpecifier.providerId;
  let model = resolvedModelId;

  if (!provider) {
    provider = findProviderFromModel(resolvedModelId);
    const modelInfo = findModel(resolvedModelId);
    if (modelInfo) {
      model = modelInfo.id;
    }
  }

  if (!provider) {
    throw new Error('No provider resolved for model "' + model + '". Configure runtime configuration (getModelsConfig) with a default provider, register the provider, or pass providerId explicitly.');
  }

  const registeredProvider = getProvider(provider);
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
    throw new Error(`No API key configured for provider: ${provider}. Register the provider with registerProvider or configure getApiKey in runtime configuration.`);
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
