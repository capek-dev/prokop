import { afterEach, describe, expect, test } from 'bun:test';
import { configureRuntimeConfiguration, getRuntimeConfiguration } from '@capekai/core/configuration';
import {
  configureJean2RuntimeConfiguration,
  createJean2RuntimeConfiguration,
  jean2RuntimeConfiguration,
  withContractTier,
} from '@/adapters/capek/runtime-configuration';
import * as configModule from '@/config';
import * as environment from '@/infrastructure/runtime/environment';

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

  test('forwards every model and compaction accessor by identity, wrapping the tier-shimmed ones', () => {
    const configuration = createJean2RuntimeConfiguration({ ...environment });

    // findModel/getModelsConfig are wrapped by the capek-contract tier shim
    // (pinned Capek still requires the legacy field), so they are not the
    // raw config-module references anymore; the shim itself is unit-tested
    // below without touching the models.json on disk.
    expect(typeof configuration.findModel).toBe('function');
    expect(configuration.findModelVariant).toBe(configModule.findModelVariant);
    expect(configuration.getMaxOutputTokens).toBe(configModule.getMaxOutputTokens);
    expect(configuration.getLLMTemperature).toBe(environment.getLLMTemperature);
    expect(configuration.getLLMMaxSteps).toBe(environment.getLLMMaxSteps);
    expect(configuration.getLLMSubagentMaxSteps).toBe(environment.getLLMSubagentMaxSteps);
    expect(configuration.getLLMBaseUrl).toBe(environment.getLLMBaseUrl);
    expect(configuration.getCompactionModel).toBe(environment.getCompactionModel);
    expect(configuration.getCompactionProvider).toBe(environment.getCompactionProvider);
    expect(configuration.getCompactionMaxTokens).toBe(environment.getCompactionMaxTokens);
    expect(configuration.getCompactionPreserveRecentToolCount).toBe(environment.getCompactionPreserveRecentToolCount);
    expect(configuration.getCompactionPreserveSmallToolChars).toBe(environment.getCompactionPreserveSmallToolChars);
    expect(configuration.getCompactionToolClearCharsThreshold).toBe(environment.getCompactionToolClearCharsThreshold);
    expect(configuration.getCompactionMaxPrunedToolCount).toBe(environment.getCompactionMaxPrunedToolCount);
    expect(configuration.getCompactionAutoThresholdRatio).toBe(environment.getCompactionAutoThresholdRatio);
    expect(configuration.getCompactionAutoReserveCapTokens).toBe(environment.getCompactionAutoReserveCapTokens);
    expect(configuration.getCompactionAutoSafetyMarginTokens).toBe(environment.getCompactionAutoSafetyMarginTokens);
  });

  test('maps provider API keys to distinct controlled accessor values without renaming providers', () => {
    const configuration = createJean2RuntimeConfiguration({
      getLLMOpenRouterApiKey: () => 'openrouter-key-2',
      getLLMMinimaxApiKey: () => 'minimax-key-3',
      getLLMZhipuCodingApiKey: () => 'zhipu-coding-key-5',
      getLLMDeepseekApiKey: () => 'deepseek-key-6',
    });

    expect(configuration.getApiKey('openai')).toBeUndefined();
    expect(configuration.getApiKey('openrouter')).toBe('openrouter-key-2');
    expect(configuration.getApiKey('minimax')).toBe('minimax-key-3');
    expect(configuration.getApiKey('zhipu')).toBeUndefined();
    expect(configuration.getApiKey('zhipu-coding')).toBe('zhipu-coding-key-5');
    expect(configuration.getApiKey('deepseek')).toBe('deepseek-key-6');
    expect(configuration.getApiKey('unknown-provider')).toBeUndefined();
  });

  test('the tier shim defaults the legacy capek-contract field without overwriting a stored one', () => {
    const withoutTier = withContractTier({ id: 'm', name: 'M', contextWindow: 1000 });
    expect(withoutTier.tier).toBe('standard');
    const withTier = withContractTier({ id: 'm', name: 'M', contextWindow: 1000, tier: 'premium' });
    expect(withTier.tier).toBe('premium');
  });

  test('installs the module-level runtime configuration by identity', () => {
    configureJean2RuntimeConfiguration();
    expect(getRuntimeConfiguration()).toBe(jean2RuntimeConfiguration);
  });
});
