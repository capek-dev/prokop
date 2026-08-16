import type { ProviderCredentialStatus } from '@jean2/sdk';

/**
 * Provider-accounts domain: provider credential policy.
 *
 * Owns the supported API-key credential registry (provider id to env key),
 * the credential input validation rules, and the environment-file line
 * merge policy. The environment file I/O and env reload stay in
 * `configuration/provider-credentials.ts`; it consumes these rules.
 */

export interface ProviderCredentialDefinition {
  provider: string;
  envKey: string;
}

export const PROVIDER_CREDENTIALS: readonly ProviderCredentialDefinition[] = [
  { provider: 'minimax', envKey: 'JEAN2_LLM_MINIMAX_API_KEY' },
  { provider: 'openai', envKey: 'JEAN2_LLM_OPENAI_API_KEY' },
  { provider: 'openrouter', envKey: 'JEAN2_LLM_OPENROUTER_API_KEY' },
  { provider: 'zhipu', envKey: 'JEAN2_LLM_ZHIPU_API_KEY' },
  { provider: 'zhipu-coding', envKey: 'JEAN2_LLM_ZHIPU_CODING_API_KEY' },
  { provider: 'deepseek', envKey: 'JEAN2_LLM_DEEPSEEK_API_KEY' },
];

export function getSupportedProviderCredential(
  provider: string,
): ProviderCredentialDefinition | undefined {
  return PROVIDER_CREDENTIALS.find((p) => p.provider === provider);
}

export const API_KEY_EMPTY_ERROR = 'API key must be a non-empty string';

export function validateApiKeyValue(apiKey: string): string | null {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
    return API_KEY_EMPTY_ERROR;
  }
  return null;
}

/**
 * Environment-file line policy: replace the target key's value in place,
 * appending the line when the key is absent. Blank and comment lines pass
 * through untouched.
 */
export function mergeEnvLine(
  content: string | null,
  targetKey: string,
  targetValue: string,
): { content: string; keyFound: boolean } {
  const lines = content ? content.split('\n') : [];
  let keyFound = false;

  const updatedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return line;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return line;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (key === targetKey) {
      keyFound = true;
      return `${targetKey}=${targetValue}`;
    }

    return line;
  });

  if (!keyFound) {
    updatedLines.push(`${targetKey}=${targetValue}`);
  }

  return { content: updatedLines.join('\n') + '\n', keyFound };
}

/** Environment-file line policy: drop every line assigning the target key. */
export function removeEnvLine(
  content: string | null,
  targetKey: string,
): string {
  if (!content) return '';
  const lines = content.split('\n');

  const updatedLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return true;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return true;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    return key !== targetKey;
  });

  return updatedLines.join('\n') + '\n';
}

export function credentialStatus(
  provider: string,
  configured: boolean,
): ProviderCredentialStatus {
  return { provider, configured };
}
