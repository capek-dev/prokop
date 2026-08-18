export type AttachmentKind = 'image' | 'video' | 'file';

export interface ModelCapabilities {
  input?: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    file?: string[];
  };
}

/**
 * Model tier for pricing categorization
 */
export type ModelTier = 'budget' | 'standard' | 'premium';

export interface VariantOption {
  providerOptions: Record<string, unknown>;
}

/**
 * Definition of an LLM model
 */
export interface ModelDefinition {
  /** Unique model identifier (e.g., "gpt-4o", "anthropic/claude-3.5-sonnet") */
  id: string;
  /** Human-readable model name */
  name: string;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Pricing tier */
  tier: ModelTier;
  variants?: Record<string, VariantOption>;
  capabilities?: ModelCapabilities;
}

/**
 * Definition of an LLM provider
 */
export interface ProviderDefinition {
  /** Provider identifier (e.g., "openai", "anthropic") */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Models available from this provider */
  models: ModelDefinition[];
}

/**
 * Model with provider info attached
 */
export interface ModelWithProvider extends ModelDefinition {
  providerId: string;
  providerName: string;
}

/**
 * Full models configuration
 */
export interface ModelsConfig {
  providers: ProviderDefinition[];
  defaultModel: string;
  defaultProvider: string;
}
