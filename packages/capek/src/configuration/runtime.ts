import { AsyncLocalStorage } from 'node:async_hooks';
import type { RuntimeConfiguration } from './contracts';
import { createDefaultRuntimeConfiguration } from './defaults';

let configuration = createDefaultRuntimeConfiguration();
const scopedConfiguration = new AsyncLocalStorage<RuntimeConfiguration>();

function activeConfiguration(): RuntimeConfiguration {
  return scopedConfiguration.getStore() ?? configuration;
}

export function withRuntimeConfiguration<T>(value: RuntimeConfiguration, callback: () => T): T {
  return scopedConfiguration.run(value, callback);
}

export function configureRuntimeConfiguration(value?: RuntimeConfiguration): void {
  configuration = value ?? createDefaultRuntimeConfiguration();
}

export function getRuntimeConfiguration(): RuntimeConfiguration {
  return activeConfiguration();
}

export const findModel = (...args: Parameters<RuntimeConfiguration['findModel']>) => activeConfiguration().findModel(...args);
export const getMaxOutputTokens = (...args: Parameters<RuntimeConfiguration['getMaxOutputTokens']>) => activeConfiguration().getMaxOutputTokens(...args);
export const findModelVariant = (...args: Parameters<RuntimeConfiguration['findModelVariant']>) => activeConfiguration().findModelVariant(...args);
export const getModelsConfig = () => activeConfiguration().getModelsConfig();
export const getLLMTemperature = () => activeConfiguration().getLLMTemperature();
export const getLLMMaxSteps = () => activeConfiguration().getLLMMaxSteps();
export const getLLMSubagentMaxSteps = () => activeConfiguration().getLLMSubagentMaxSteps();
export const getLLMBaseUrl = () => activeConfiguration().getLLMBaseUrl();
export const getApiKeyForProvider = (providerId: string) => activeConfiguration().getApiKey(providerId);
export const getCompactionModel = () => activeConfiguration().getCompactionModel();
export const getCompactionProvider = () => activeConfiguration().getCompactionProvider();
export const getCompactionMaxTokens = () => activeConfiguration().getCompactionMaxTokens();
export const getCompactionPreserveRecentToolCount = () => activeConfiguration().getCompactionPreserveRecentToolCount();
export const getCompactionPreserveSmallToolChars = () => activeConfiguration().getCompactionPreserveSmallToolChars();
export const getCompactionToolClearCharsThreshold = () => activeConfiguration().getCompactionToolClearCharsThreshold();
export const getCompactionMaxPrunedToolCount = () => activeConfiguration().getCompactionMaxPrunedToolCount();
export const getCompactionAutoThresholdRatio = () => activeConfiguration().getCompactionAutoThresholdRatio();
export const getCompactionAutoReserveCapTokens = () => activeConfiguration().getCompactionAutoReserveCapTokens();
export const getCompactionAutoSafetyMarginTokens = () => activeConfiguration().getCompactionAutoSafetyMarginTokens();
