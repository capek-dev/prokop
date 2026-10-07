export interface ModelCapabilities {
  input?: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    file?: string[];
  };
  structuredOutput?: { mode: 'native' | 'prompt' };
}

export interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  tier: 'budget' | 'standard' | 'premium';
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: ModelCapabilities;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  models: ModelDefinition[];
}

export interface ModelWithProvider extends ModelDefinition {
  providerId: string;
  providerName: string;
}

export interface ModelsConfig {
  providers: ProviderDefinition[];
  defaultModel: string;
  defaultProvider: string;
}

export interface RuntimeConfiguration {
  findModel(modelId: string, providerId?: string): ModelWithProvider | undefined;
  getMaxOutputTokens(modelId?: string): number;
  findModelVariant(modelId: string, variantKey: string, providerId?: string): Record<string, unknown> | undefined;
  getModelsConfig(): ModelsConfig;
  getLLMTemperature(): number;
  getLLMMaxSteps(): number;
  getLLMSubagentMaxSteps(): number;
  getLLMBaseUrl(): string | undefined;
  getApiKey(providerId: string): string | undefined;
  getCompactionModel(): string | undefined;
  getCompactionProvider(): string | undefined;
  getCompactionMaxTokens(): number;
  getCompactionPreserveRecentToolCount(): number;
  getCompactionPreserveSmallToolChars(): number;
  getCompactionToolClearCharsThreshold(): number;
  getCompactionMaxPrunedToolCount(): number;
  getCompactionAutoThresholdRatio(): number;
  getCompactionAutoReserveCapTokens(): number;
  getCompactionAutoSafetyMarginTokens(): number;
}
