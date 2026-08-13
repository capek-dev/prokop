import type { RuntimeConfiguration } from './contracts';
import { createDefaultRuntimeConfiguration } from './defaults';

let configuration = createDefaultRuntimeConfiguration();

export function configureRuntimeConfiguration(value?: RuntimeConfiguration): void {
  configuration = value ?? createDefaultRuntimeConfiguration();
}

export function getRuntimeConfiguration(): RuntimeConfiguration {
  return configuration;
}

export const findModel = (...args: Parameters<RuntimeConfiguration['findModel']>) => configuration.findModel(...args);
export const getMaxOutputTokens = (...args: Parameters<RuntimeConfiguration['getMaxOutputTokens']>) => configuration.getMaxOutputTokens(...args);
export const findModelVariant = (...args: Parameters<RuntimeConfiguration['findModelVariant']>) => configuration.findModelVariant(...args);
export const getModelsConfig = () => configuration.getModelsConfig();
export const getLLMTemperature = () => configuration.getLLMTemperature();
export const getLLMMaxSteps = () => configuration.getLLMMaxSteps();
export const getLLMSubagentMaxSteps = () => configuration.getLLMSubagentMaxSteps();
export const getLLMBaseUrl = () => configuration.getLLMBaseUrl();
export const getApiKeyForProvider = (providerId: string) => configuration.getApiKey(providerId);
export const getCompactionModel = () => configuration.getCompactionModel();
export const getCompactionProvider = () => configuration.getCompactionProvider();
export const getCompactionMaxTokens = () => configuration.getCompactionMaxTokens();
export const getCompactionPreserveRecentToolCount = () => configuration.getCompactionPreserveRecentToolCount();
export const getCompactionPreserveSmallToolChars = () => configuration.getCompactionPreserveSmallToolChars();
export const getCompactionToolClearCharsThreshold = () => configuration.getCompactionToolClearCharsThreshold();
export const getCompactionMaxPrunedToolCount = () => configuration.getCompactionMaxPrunedToolCount();
export const getCompactionAutoThresholdRatio = () => configuration.getCompactionAutoThresholdRatio();
export const getCompactionAutoReserveCapTokens = () => configuration.getCompactionAutoReserveCapTokens();
export const getCompactionAutoSafetyMarginTokens = () => configuration.getCompactionAutoSafetyMarginTokens();
