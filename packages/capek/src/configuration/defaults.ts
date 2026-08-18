import type { RuntimeConfiguration } from './contracts';

const OUTPUT_TOKEN_MAX = 32000;

export function createDefaultRuntimeConfiguration(): RuntimeConfiguration {
  return {
    findModel: () => undefined,
    getMaxOutputTokens: () => OUTPUT_TOKEN_MAX,
    findModelVariant: () => undefined,
    getModelsConfig: () => ({ providers: [], defaultModel: '', defaultProvider: '' }),
    getLLMTemperature: () => 0.7,
    getLLMMaxSteps: () => 10,
    getLLMSubagentMaxSteps: () => 50,
    getLLMBaseUrl: () => undefined,
    getApiKey: () => undefined,
    getCompactionModel: () => undefined,
    getCompactionProvider: () => undefined,
    getCompactionMaxTokens: () => 8000,
    getCompactionPreserveRecentToolCount: () => 3,
    getCompactionPreserveSmallToolChars: () => 200,
    getCompactionToolClearCharsThreshold: () => 1000,
    getCompactionMaxPrunedToolCount: () => 50,
    getCompactionAutoThresholdRatio: () => 0.75,
    getCompactionAutoReserveCapTokens: () => 32000,
    getCompactionAutoSafetyMarginTokens: () => 20000,
  };
}
