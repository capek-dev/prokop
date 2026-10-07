import { type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import {
  findProviderFromModel,
  openAiModelOmitsTemperature,
  parseModelSpecifier,
} from '@/infrastructure/providers/model-selection';
import {
  findModel,
  getApiKeyForProvider,
  getLLMBaseUrl,
  getModelsConfig,
} from '@/infrastructure/providers/configuration/runtime';
import { createModelForProvider, getProvider } from '@/infrastructure/providers/registry';
import { isSandboxActive } from '@/infrastructure/runtime/host-dependencies';

export interface ModelWithMetadata {
  model: LanguageModel;
  /** Replay stored reasoning only for adapters that accept unsigned reasoning text. */
  replayReasoning?: boolean;
  useProviderInstructions?: boolean;
  omitMaxOutputTokens?: boolean;
  omitTemperature?: boolean;
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
      omitTemperature: result.omitTemperature,
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
      omitTemperature: result.omitTemperature,
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

    case 'minimax':
    case 'zhipu':
    case 'zhipu-coding': {
      const { createProtocolModel } = await import('@/infrastructure/providers/protocol-model');
      return { model: createProtocolModel(provider, model, apiKey) };
    }

    case 'deepseek': {
      const { createProtocolModel } = await import('@/infrastructure/providers/protocol-model');
      return { model: createProtocolModel(provider, model, apiKey), replayReasoning: true };
    }

    case 'openai':
    default: {
      const openai = createOpenAI({
        apiKey,
        baseURL: getLLMBaseUrl() || undefined,
      });
      return {
        model: openai.responses(model) as unknown as LanguageModel,
        omitTemperature: openAiModelOmitsTemperature(model),
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
