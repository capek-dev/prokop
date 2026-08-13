import { findModel } from '../compat/jean2-dependencies';
import {
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMMinimaxApiKey,
  getLLMZhipuApiKey,
  getLLMZhipuCodingApiKey,
  getLLMDeepseekApiKey,
  getModelsConfig,
} from '../compat/jean2-dependencies';
import type { Session, Preconfig } from '@jean2/sdk';

export type Provider = 'openai' | 'openrouter' | 'minimax' | 'zhipu' | 'zhipu-coding' | 'deepseek';

const PROVIDER_PREFIXES: Array<{ test: (m: string) => boolean; provider: string }> = [
  { test: (m) => m.includes('/'), provider: 'openrouter' },
  { test: (m) => m.startsWith('MiniMax-') || m.toLowerCase().includes('minimax'), provider: 'minimax' },
  { test: (m) => m.startsWith('deepseek-'), provider: 'deepseek' },
];

export function findProviderFromModel(modelId: string): string {
  const modelInfo = findModel(modelId);
  if (modelInfo) return modelInfo.providerId;

  for (const { test, provider } of PROVIDER_PREFIXES) {
    if (test(modelId)) return provider;
  }
  return 'openai';
}

const apiKeyGetterMap: Record<string, () => string | undefined> = {
  openai: getLLMOpenAIApiKey,
  openrouter: getLLMOpenRouterApiKey,
  minimax: getLLMMinimaxApiKey,
  zhipu: getLLMZhipuApiKey,
  'zhipu-coding': getLLMZhipuCodingApiKey,
  deepseek: getLLMDeepseekApiKey,
};

export function getApiKeyForProvider(provider: string): string | undefined {
  const getter = apiKeyGetterMap[provider];
  return getter ? getter() : undefined;
}

export function resolveModelId(
  session: Pick<Session, 'selectedModel'> | null,
  preconfig: Pick<Preconfig, 'model'> | null | undefined,
): string {
  return session?.selectedModel || preconfig?.model || getModelsConfig().defaultModel;
}

export function resolveProviderId(
  session: Pick<Session, 'selectedProvider'> | null,
  preconfig: Pick<Preconfig, 'model'> | null | undefined,
): string {
  return (
    session?.selectedProvider ||
    (preconfig?.model ? findProviderFromModel(preconfig.model) : null) ||
    getModelsConfig().defaultProvider
  );
}
