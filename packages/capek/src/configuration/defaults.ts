import type { ModelWithProvider, ModelsConfig, RuntimeConfiguration } from './contracts';

const OUTPUT_TOKEN_MAX = 32000;

const defaultModels: ModelsConfig = {
  providers: [{
    id: 'openai',
    name: 'OpenAI',
    models: [{
      id: 'gpt-4o',
      name: 'GPT-4o',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      tier: 'standard',
    }],
  }],
  defaultModel: 'gpt-4o',
  defaultProvider: 'openai',
};

function positiveInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function findModel(modelId: string, providerId?: string): ModelWithProvider | undefined {
  const providers = providerId
    ? defaultModels.providers.filter((provider) => provider.id === providerId)
    : defaultModels.providers;
  for (const provider of providers) {
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (model) return { ...model, providerId: provider.id, providerName: provider.name };
  }
  return undefined;
}

export function createDefaultRuntimeConfiguration(): RuntimeConfiguration {
  return {
    findModel,
    getMaxOutputTokens(modelId) {
      const cap = positiveInt('JEAN2_LLM_MAX_TOKENS', OUTPUT_TOKEN_MAX);
      const model = modelId ? findModel(modelId) : undefined;
      return model?.maxOutputTokens ? Math.min(model.maxOutputTokens, cap) : cap;
    },
    findModelVariant(modelId, variantKey, providerId) {
      return findModel(modelId, providerId)?.variants?.[variantKey]?.providerOptions;
    },
    getModelsConfig: () => defaultModels,
    getLLMTemperature() {
      const parsed = parseFloat(process.env.JEAN2_LLM_TEMPERATURE || '0.7');
      return Number.isFinite(parsed) ? parsed : 0.7;
    },
    getLLMMaxSteps: () => positiveInt('JEAN2_LLM_MAX_STEPS', 10),
    getLLMSubagentMaxSteps: () => positiveInt('JEAN2_LLM_SUBAGENT_MAX_STEPS', 50),
    getLLMBaseUrl: () => process.env.JEAN2_LLM_BASE_URL,
    getApiKey(providerId) {
      return process.env[`JEAN2_LLM_${providerId.toUpperCase().replaceAll('-', '_')}_API_KEY`];
    },
    getCompactionModel: () => process.env.JEAN2_COMPACTION_MODEL,
    getCompactionProvider: () => process.env.JEAN2_COMPACTION_PROVIDER,
    getCompactionMaxTokens: () => positiveInt('JEAN2_COMPACTION_MAX_TOKENS', 8000),
    getCompactionPreserveRecentToolCount: () => nonNegativeInt('JEAN2_COMPACTION_PRESERVE_RECENT_TOOL_COUNT', 3),
    getCompactionPreserveSmallToolChars: () => nonNegativeInt('JEAN2_COMPACTION_PRESERVE_SMALL_TOOL_CHARS', 200),
    getCompactionToolClearCharsThreshold: () => nonNegativeInt('JEAN2_COMPACTION_TOOL_CLEAR_CHARS_THRESHOLD', 1000),
    getCompactionMaxPrunedToolCount: () => nonNegativeInt('JEAN2_COMPACTION_MAX_PRUNED_TOOL_COUNT', 50),
    getCompactionAutoThresholdRatio() {
      const parsed = parseFloat(process.env.JEAN2_COMPACTION_AUTO_THRESHOLD_RATIO || '0.75');
      return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.75;
    },
    getCompactionAutoReserveCapTokens: () => positiveInt('JEAN2_COMPACTION_AUTO_RESERVE_CAP_TOKENS', 32000),
    getCompactionAutoSafetyMarginTokens: () => nonNegativeInt('JEAN2_COMPACTION_AUTO_SAFETY_MARGIN_TOKENS', 20000),
  };
}
