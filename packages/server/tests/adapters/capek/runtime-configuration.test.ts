import { afterEach, describe, expect, mock, test } from 'bun:test';
import { configureRuntimeConfiguration, getRuntimeConfiguration } from '@capekai/core/compat/jean2';

const realEnv = await import('@/env');

const realGetLLMTemperature = realEnv.getLLMTemperature;
const realGetLLMMaxSteps = realEnv.getLLMMaxSteps;
const realGetLLMSubagentMaxSteps = realEnv.getLLMSubagentMaxSteps;
const realGetLLMBaseUrl = realEnv.getLLMBaseUrl;
const realGetCompactionModel = realEnv.getCompactionModel;
const realGetCompactionProvider = realEnv.getCompactionProvider;
const realGetCompactionMaxTokens = realEnv.getCompactionMaxTokens;
const realGetCompactionPreserveRecentToolCount = realEnv.getCompactionPreserveRecentToolCount;
const realGetCompactionPreserveSmallToolChars = realEnv.getCompactionPreserveSmallToolChars;
const realGetCompactionToolClearCharsThreshold = realEnv.getCompactionToolClearCharsThreshold;
const realGetCompactionMaxPrunedToolCount = realEnv.getCompactionMaxPrunedToolCount;
const realGetCompactionAutoThresholdRatio = realEnv.getCompactionAutoThresholdRatio;
const realGetCompactionAutoReserveCapTokens = realEnv.getCompactionAutoReserveCapTokens;
const realGetCompactionAutoSafetyMarginTokens = realEnv.getCompactionAutoSafetyMarginTokens;

// File-scoped module mock. The API key getters return distinct controlled
// values so provider mapping mistakes cannot hide behind equal values or the
// developer's real environment configuration. All other env exports stay real.
mock.module('@/env', () => ({
  ...realEnv,
  getLLMOpenAIApiKey: (): string | undefined => 'openai-key-1',
  getLLMOpenRouterApiKey: (): string | undefined => 'openrouter-key-2',
  getLLMMinimaxApiKey: (): string | undefined => 'minimax-key-3',
  getLLMZhipuApiKey: (): string | undefined => 'zhipu-key-4',
  getLLMZhipuCodingApiKey: (): string | undefined => 'zhipu-coding-key-5',
  getLLMDeepseekApiKey: (): string | undefined => 'deepseek-key-6',
}));

const adapter = await import('@/adapters/capek/runtime-configuration');
const configModule = await import('@/config');
const jean2RuntimeConfiguration = adapter.jean2RuntimeConfiguration;
const configureJean2RuntimeConfiguration = adapter.configureJean2RuntimeConfiguration;

describe('Čapek runtime configuration adapter', () => {
  afterEach(() => {
    configureRuntimeConfiguration();
  });

  test('exposes the exact accessor set with no shadowed extras', () => {
    expect(Object.keys(jean2RuntimeConfiguration).sort()).toEqual([
      'findModel', 'getMaxOutputTokens', 'findModelVariant', 'getModelsConfig',
      'getLLMTemperature', 'getLLMMaxSteps', 'getLLMSubagentMaxSteps', 'getLLMBaseUrl',
      'getApiKey', 'getCompactionModel', 'getCompactionProvider', 'getCompactionMaxTokens',
      'getCompactionPreserveRecentToolCount', 'getCompactionPreserveSmallToolChars',
      'getCompactionToolClearCharsThreshold', 'getCompactionMaxPrunedToolCount',
      'getCompactionAutoThresholdRatio', 'getCompactionAutoReserveCapTokens',
      'getCompactionAutoSafetyMarginTokens',
    ].sort());
  });

  test('forwards every model and compaction accessor by identity', () => {
    expect(jean2RuntimeConfiguration.findModel).toBe(configModule.findModel);
    expect(jean2RuntimeConfiguration.findModelVariant).toBe(configModule.findModelVariant);
    expect(jean2RuntimeConfiguration.getModelsConfig).toBe(configModule.getModelsConfig);
    expect(jean2RuntimeConfiguration.getMaxOutputTokens).toBe(configModule.getMaxOutputTokens);
    expect(jean2RuntimeConfiguration.getLLMTemperature).toBe(realGetLLMTemperature);
    expect(jean2RuntimeConfiguration.getLLMMaxSteps).toBe(realGetLLMMaxSteps);
    expect(jean2RuntimeConfiguration.getLLMSubagentMaxSteps).toBe(realGetLLMSubagentMaxSteps);
    expect(jean2RuntimeConfiguration.getLLMBaseUrl).toBe(realGetLLMBaseUrl);
    expect(jean2RuntimeConfiguration.getCompactionModel).toBe(realGetCompactionModel);
    expect(jean2RuntimeConfiguration.getCompactionProvider).toBe(realGetCompactionProvider);
    expect(jean2RuntimeConfiguration.getCompactionMaxTokens).toBe(realGetCompactionMaxTokens);
    expect(jean2RuntimeConfiguration.getCompactionPreserveRecentToolCount).toBe(realGetCompactionPreserveRecentToolCount);
    expect(jean2RuntimeConfiguration.getCompactionPreserveSmallToolChars).toBe(realGetCompactionPreserveSmallToolChars);
    expect(jean2RuntimeConfiguration.getCompactionToolClearCharsThreshold).toBe(realGetCompactionToolClearCharsThreshold);
    expect(jean2RuntimeConfiguration.getCompactionMaxPrunedToolCount).toBe(realGetCompactionMaxPrunedToolCount);
    expect(jean2RuntimeConfiguration.getCompactionAutoThresholdRatio).toBe(realGetCompactionAutoThresholdRatio);
    expect(jean2RuntimeConfiguration.getCompactionAutoReserveCapTokens).toBe(realGetCompactionAutoReserveCapTokens);
    expect(jean2RuntimeConfiguration.getCompactionAutoSafetyMarginTokens).toBe(realGetCompactionAutoSafetyMarginTokens);
  });

  test('maps provider API keys to distinct controlled accessor values without renaming providers', () => {
    expect(jean2RuntimeConfiguration.getApiKey('openai')).toBe('openai-key-1');
    expect(jean2RuntimeConfiguration.getApiKey('openrouter')).toBe('openrouter-key-2');
    expect(jean2RuntimeConfiguration.getApiKey('minimax')).toBe('minimax-key-3');
    expect(jean2RuntimeConfiguration.getApiKey('zhipu')).toBe('zhipu-key-4');
    expect(jean2RuntimeConfiguration.getApiKey('zhipu-coding')).toBe('zhipu-coding-key-5');
    expect(jean2RuntimeConfiguration.getApiKey('deepseek')).toBe('deepseek-key-6');
    expect(jean2RuntimeConfiguration.getApiKey('unknown-provider')).toBeUndefined();
  });

  test('installs the module-level runtime configuration by identity', () => {
    configureJean2RuntimeConfiguration();
    expect(getRuntimeConfiguration()).toBe(jean2RuntimeConfiguration);
  });
});
