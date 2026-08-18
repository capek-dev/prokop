import { findModel, getModelsConfig } from '../configuration/runtime';
import { getProvider } from '../providers/registry';
import type { Session, Preconfig } from '@capekai/types';

export type Provider = 'openai' | 'openrouter' | 'minimax' | 'zhipu' | 'zhipu-coding' | 'deepseek';

const EXPLICIT_PROVIDERS = new Set<Provider>([
  'openai',
  'openrouter',
  'minimax',
  'zhipu',
  'zhipu-coding',
  'deepseek',
]);

const PROVIDER_PREFIXES: Array<{ test: (m: string) => boolean; provider: string }> = [
  { test: (m) => m.includes('/'), provider: 'openrouter' },
  { test: (m) => m.startsWith('MiniMax-') || m.toLowerCase().includes('minimax'), provider: 'minimax' },
  { test: (m) => m.startsWith('deepseek-'), provider: 'deepseek' },
];

export interface ParsedModelSpecifier {
  modelId: string;
  providerId?: string;
}

export function parseModelSpecifier(modelId: string): ParsedModelSpecifier {
  const separator = modelId.indexOf('/');
  if (separator <= 0 || separator === modelId.length - 1) return { modelId };
  const providerId = modelId.slice(0, separator) as Provider;
  if (!EXPLICIT_PROVIDERS.has(providerId) && !getProvider(providerId)) return { modelId };
  return {
    providerId,
    modelId: modelId.slice(separator + 1),
  };
}

export function findProviderFromModel(modelId: string): string {
  const modelInfo = findModel(modelId);
  if (modelInfo) return modelInfo.providerId;

  const parsed = parseModelSpecifier(modelId);
  if (parsed.providerId) return parsed.providerId;

  for (const { test, provider } of PROVIDER_PREFIXES) {
    if (test(modelId)) return provider;
  }
  return getModelsConfig().defaultProvider;
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
