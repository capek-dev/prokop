import { afterEach, describe, expect, test } from 'bun:test';
import type { LanguageModel } from 'ai';
import { createDefaultRuntimeConfiguration } from '@/infrastructure/providers/configuration/defaults';
import {
  configureRuntimeConfiguration,
  findModel,
  findModelVariant,
  getMaxOutputTokens,
} from '@/infrastructure/providers/configuration/runtime';
import { getModelWithMetadata } from '@/infrastructure/providers/model-resolution';
import { findProviderFromModel, resolveModelId, resolveProviderId } from '@/infrastructure/providers/model-selection';
import {
  connectProvider,
  createModelForProvider,
  getProviderStatus,
  registerProvider,
  resetProviders,
} from '@/infrastructure/providers/registry';

afterEach(() => {
  configureRuntimeConfiguration();
  resetProviders();
});

describe('runtime configuration', () => {
  test('preserves model lookup, variants, output cap, and fallback order', () => {
    const base = createDefaultRuntimeConfiguration();
    configureRuntimeConfiguration({
      ...base,
      findModel(modelId, providerId) {
        if (modelId !== 'shared' || (providerId && providerId !== 'custom')) return undefined;
        return {
          id: 'shared', name: 'Shared', contextWindow: 100000, maxOutputTokens: 64000,
          tier: 'standard', providerId: 'custom', providerName: 'Custom',
          variants: { max: { providerOptions: { reasoningEffort: 'max' } } },
        };
      },
      getMaxOutputTokens(modelId) {
        const model = this.findModel(modelId ?? '');
        return model?.maxOutputTokens ? Math.min(model.maxOutputTokens, 32000) : 32000;
      },
      findModelVariant(modelId, key, providerId) {
        return this.findModel(modelId, providerId)?.variants?.[key]?.providerOptions;
      },
      getModelsConfig: () => ({ providers: [], defaultModel: 'fallback-model', defaultProvider: 'fallback-provider' }),
    });

    expect(findModel('shared', 'custom')?.providerId).toBe('custom');
    expect(findModelVariant('shared', 'max')).toEqual({ reasoningEffort: 'max' });
    expect(getMaxOutputTokens('shared')).toBe(32000);
    expect(resolveModelId({ selectedModel: 'session' }, { model: 'preconfig' })).toBe('session');
    expect(resolveModelId(null, { model: 'preconfig' })).toBe('preconfig');
    expect(resolveModelId(null, null)).toBe('fallback-model');
    expect(resolveProviderId({ selectedProvider: 'session' }, null)).toBe('session');
    expect(resolveProviderId(null, null)).toBe('fallback-provider');
  });

  test('uses neutral defaults and explicit provider inference', () => {
    configureRuntimeConfiguration();
    expect(getMaxOutputTokens()).toBe(32000);
    expect(findProviderFromModel('unknown')).toBe('');

    const model = {
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      tier: 'standard' as const,
    };
    configureRuntimeConfiguration({
      ...createDefaultRuntimeConfiguration(),
      findModel: (modelId, providerId) => modelId === 'gpt-4o' && (!providerId || providerId === 'openai')
        ? { ...model, providerId: 'openai', providerName: 'OpenAI' }
        : undefined,
      getModelsConfig: () => ({
        providers: [{ id: 'openai', name: 'OpenAI', models: [model] }],
        defaultModel: 'gpt-4o',
        defaultProvider: 'openai',
      }),
    });

    expect(findProviderFromModel('org/model')).toBe('openrouter');
    expect(findProviderFromModel('MiniMax-M2')).toBe('minimax');
    expect(findProviderFromModel('deepseek-chat')).toBe('deepseek');
    expect(findProviderFromModel('gpt-4o')).toBe('openai');
  });

  test('omits temperature for GPT-5 mini and GPT-6 OpenAI Responses models', async () => {
    configureRuntimeConfiguration({
      ...createDefaultRuntimeConfiguration(),
      getApiKey: (providerId) => providerId === 'openai' ? 'test-key' : undefined,
    });

    for (const modelId of ['gpt-5-mini', 'gpt-6.5-astra']) {
      const result = await getModelWithMetadata({ modelId, providerId: 'openai' });
      expect(result.omitTemperature).toBe(true);
    }
    const older = await getModelWithMetadata({ modelId: 'gpt-4o', providerId: 'openai' });
    expect(older.omitTemperature).toBe(false);
  });

  test('normalizes explicit provider and model specifiers', async () => {
    const model = {} as LanguageModel;
    registerProvider({
      descriptor: { id: 'openai', displayName: 'OpenAI', authType: 'none', connectable: true },
      getStatus: () => ({ provider: 'openai', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => {
        expect(options.providerId).toBe('openai');
        expect(options.modelId).toBe('gpt-4o-mini');
        return { model };
      },
    });

    expect((await getModelWithMetadata({ modelId: 'openai/gpt-4o-mini' })).model).toBe(model);
  });

  test('resolves the configured default model without product bindings', async () => {
    configureRuntimeConfiguration({
      ...createDefaultRuntimeConfiguration(),
      getModelsConfig: () => ({ providers: [], defaultModel: 'configured-model', defaultProvider: 'custom' }),
    });
    const model = {} as LanguageModel;
    registerProvider({
      descriptor: { id: 'custom', displayName: 'Custom', authType: 'none', connectable: true },
      getStatus: () => ({ provider: 'custom', connected: true }),
      connect: async () => ({}),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async (options) => {
        expect(options.modelId).toBe('configured-model');
        return { model };
      },
    });

    expect((await getModelWithMetadata({ providerId: 'custom' })).model).toBe(model);
  });
});

describe('provider registry', () => {
  test('registers product providers and preserves exact factory errors', async () => {
    const model = {} as LanguageModel;
    registerProvider({
      descriptor: { id: 'custom', displayName: 'Custom', authType: 'none', connectable: true },
      getStatus: () => ({ provider: 'custom', connected: true }),
      connect: async () => ({ flowId: 'flow' }),
      disconnect: async () => {},
      onTokensReceived: async () => {},
      createModel: async () => ({ model }),
    });
    expect(getProviderStatus('custom').connected).toBe(true);
    expect(await connectProvider('custom')).toEqual({ flowId: 'flow' });
    expect((await createModelForProvider({ modelId: 'm', providerId: 'custom', systemPrompt: '' })).model).toBe(model);
    await expect(connectProvider('missing')).rejects.toThrow('Unknown connectable provider: missing');
  });
});
