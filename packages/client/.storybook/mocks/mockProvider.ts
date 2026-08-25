import type {
  ProviderStatus,
  ModelWithStatus,
  ProviderDescriptor,
} from '@prokopai/sdk';
import { mockIsoNow, merge } from './mockHelpers';

// =============================================================================
// ModelWithStatus Factory
// =============================================================================

export function createModelWithStatus(
  overrides: Partial<ModelWithStatus> = {},
): ModelWithStatus {
  return merge<ModelWithStatus>(
    {
      id: 'claude-3.5-sonnet',
      name: 'Claude 3.5 Sonnet',
      contextWindow: 200_000,
      maxOutputTokens: 8192,
      tier: 'standard',
      capabilities: {
        input: { text: true, image: true, video: false },
      },
      providerId: 'anthropic',
      providerName: 'Anthropic',
      runtimeStatus: {
        providerSupported: true,
        providerConfigured: true,
        usable: true,
      },
    },
    overrides,
  );
}

// =============================================================================
// ProviderStatus Factory
// =============================================================================

export function createProviderStatus(
  overrides: Partial<ProviderStatus> = {},
): ProviderStatus {
  return merge<ProviderStatus>(
    {
      provider: overrides.provider ?? 'anthropic',
      connected: true,
      connectedAt: mockIsoNow(),
      displayName: overrides.displayName ?? 'Anthropic',
      authType: 'api_key',
      connectable: true,
    },
    overrides,
  );
}

// =============================================================================
// Provider Descriptor Factory
// =============================================================================

export function createProviderDescriptor(
  overrides: Partial<ProviderDescriptor> = {},
): ProviderDescriptor {
  return merge<ProviderDescriptor>(
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      description: 'Claude AI models by Anthropic',
      authType: 'api_key',
      connectable: true,
    },
    overrides,
  );
}

// =============================================================================
// Presets
// =============================================================================

export const providerPresets = {
  anthropic: createProviderStatus({
    provider: 'anthropic',
    displayName: 'Anthropic',
    connected: true,
    authType: 'api_key',
  }),
  openai: createProviderStatus({
    provider: 'openai',
    displayName: 'OpenAI',
    connected: true,
    authType: 'api_key',
  }),
  google: createProviderStatus({
    provider: 'google',
    displayName: 'Google AI',
    connected: true,
    authType: 'api_key',
  }),
  openrouter: createProviderStatus({
    provider: 'openrouter',
    displayName: 'OpenRouter',
    connected: false,
    authType: 'api_key',
    error: 'API key not configured',
  }),
} as const;

export const modelPresets = {
  claude35Sonnet: createModelWithStatus({
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    tier: 'standard',
    providerId: 'anthropic',
    providerName: 'Anthropic',
  }),
  claude3Opus: createModelWithStatus({
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    tier: 'premium',
    providerId: 'anthropic',
    providerName: 'Anthropic',
  }),
  gpt4o: createModelWithStatus({
    id: 'gpt-4o',
    name: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    tier: 'standard',
    capabilities: { input: { text: true, image: true, video: true } },
    providerId: 'openai',
    providerName: 'OpenAI',
  }),
  gpt4oMini: createModelWithStatus({
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextWindow: 128_000,
    maxOutputTokens: 4096,
    tier: 'budget',
    capabilities: { input: { text: true, image: true } },
    providerId: 'openai',
    providerName: 'OpenAI',
  }),
  geminiPro: createModelWithStatus({
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    contextWindow: 1_000_000,
    maxOutputTokens: 8192,
    tier: 'budget',
    capabilities: { input: { text: true, image: true, video: true } },
    providerId: 'google',
    providerName: 'Google AI',
  }),
  unavailable: createModelWithStatus({
    id: 'unavailable-model',
    name: 'Unavailable Model',
    contextWindow: 100_000,
    tier: 'standard',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    runtimeStatus: {
      providerSupported: true,
      providerConfigured: false,
      usable: false,
    },
  }),
} as const;

/** Create a full model list for a selector */
export function createModelList(): ModelWithStatus[] {
  return [
    modelPresets.claude35Sonnet,
    modelPresets.claude3Opus,
    modelPresets.gpt4o,
    modelPresets.gpt4oMini,
    modelPresets.geminiPro,
    modelPresets.unavailable,
  ];
}

/** Create a full provider list */
export function createProviderList(): ProviderStatus[] {
  return [
    providerPresets.anthropic,
    providerPresets.openai,
    providerPresets.google,
    providerPresets.openrouter,
  ];
}
