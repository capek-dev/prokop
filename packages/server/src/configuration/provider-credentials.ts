import { atomicWriteFile, readFileSafe } from './files';
import { getEnvFilePath } from '@/paths';
import { getJean2EnvValue, reloadJean2Env } from '@/env';
import {
  ConfigurationNotFoundError,
  ConfigurationPersistenceError,
  ConfigurationValidationError,
} from './errors';
import type { ProviderCredentialStatus, ProviderCredentialsResponse } from '@jean2/sdk';
import {
  getSupportedProviderCredential,
  mergeEnvLine,
  PROVIDER_CREDENTIALS,
  removeEnvLine,
  validateApiKeyValue,
} from '@/domains/provider-accounts';

function getEnvFilePathForModule(): string {
  return getEnvFilePath();
}

export { getSupportedProviderCredential };

export function listProviderCredentials(): ProviderCredentialsResponse {
  return {
    providers: PROVIDER_CREDENTIALS.map(({ provider, envKey }) => ({
      provider,
      configured: isProviderConfigured(envKey),
    })),
  };
}

export async function setProviderCredential(provider: string, apiKey: string): Promise<ProviderCredentialStatus> {
  const cred = getSupportedProviderCredential(provider);
  if (!cred) {
    throw new ConfigurationNotFoundError('provider', provider);
  }

  const validationError = validateApiKeyValue(apiKey);
  if (validationError) {
    throw new ConfigurationValidationError(validationError);
  }

  try {
    const content = await readFileSafe(getEnvFilePathForModule());
    const merged = mergeEnvLine(content, cred.envKey, apiKey.trim());

    await atomicWriteFile(getEnvFilePathForModule(), merged.content);
    reloadJean2Env();

    return { provider, configured: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to set credential for ${provider}: ${message}`);
  }
}

export async function clearProviderCredential(provider: string): Promise<ProviderCredentialStatus> {
  const cred = getSupportedProviderCredential(provider);
  if (!cred) {
    throw new ConfigurationNotFoundError('provider', provider);
  }

  try {
    const content = await readFileSafe(getEnvFilePathForModule());
    if (!content) {
      reloadJean2Env();
      return { provider, configured: false };
    }

    const updated = removeEnvLine(content, cred.envKey);

    await atomicWriteFile(getEnvFilePathForModule(), updated);
    reloadJean2Env();

    return { provider, configured: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to clear credential for ${provider}: ${message}`);
  }
}

function isProviderConfigured(envKey: string): boolean {
  const value = getJean2EnvValue(envKey);
  return value !== undefined && value !== '';
}
