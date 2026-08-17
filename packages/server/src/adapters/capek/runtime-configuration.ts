import {
  configureRuntimeConfiguration,
  type RuntimeConfiguration,
} from '@capekai/core/internal/configuration';
import {
  findModel,
  findModelVariant,
  getMaxOutputTokens,
  getModelsConfig,
} from '@/config';
import {
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
  getCompactionAutoThresholdRatio,
  getCompactionMaxPrunedToolCount,
  getCompactionMaxTokens,
  getCompactionModel,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionProvider,
  getCompactionToolClearCharsThreshold,
  getLLMBaseUrl,
  getLLMDeepseekApiKey,
  getLLMMaxSteps,
  getLLMMinimaxApiKey,
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMSubagentMaxSteps,
  getLLMTemperature,
  getLLMZhipuApiKey,
  getLLMZhipuCodingApiKey,
} from '@/infrastructure/runtime/environment';

export const jean2RuntimeConfiguration: RuntimeConfiguration = {
  findModel,
  getMaxOutputTokens,
  findModelVariant,
  getModelsConfig,
  getLLMTemperature,
  getLLMMaxSteps,
  getLLMSubagentMaxSteps,
  getLLMBaseUrl,
  getApiKey(providerId) {
    switch (providerId) {
      case 'openai': return getLLMOpenAIApiKey();
      case 'openrouter': return getLLMOpenRouterApiKey();
      case 'minimax': return getLLMMinimaxApiKey();
      case 'zhipu': return getLLMZhipuApiKey();
      case 'zhipu-coding': return getLLMZhipuCodingApiKey();
      case 'deepseek': return getLLMDeepseekApiKey();
      default: return undefined;
    }
  },
  getCompactionModel,
  getCompactionProvider,
  getCompactionMaxTokens,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionToolClearCharsThreshold,
  getCompactionMaxPrunedToolCount,
  getCompactionAutoThresholdRatio,
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
};

export function configureJean2RuntimeConfiguration(): void {
  configureRuntimeConfiguration(jean2RuntimeConfiguration);
}
