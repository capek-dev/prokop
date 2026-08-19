import type { ProviderCredentialStatus, ProviderCredentialsResponse } from '@jean2/sdk';
import { getJean2EnvValue, reloadJean2Env } from '@/infrastructure/runtime/environment';
import { getEnvFilePath } from '@/infrastructure/runtime/paths';
import { atomicWriteFile, readFileSafe } from '@/config/files';
import {
  ConfigurationNotFoundError,
  ConfigurationPersistenceError,
  ConfigurationValidationError,
} from '@/config/errors';
import {
  getSupportedProviderCredential,
  mergeEnvLine,
  PROVIDER_CREDENTIALS,
  removeEnvLine,
  validateApiKeyValue,
} from '@/domains/provider-accounts';

export { getSupportedProviderCredential };

export function listProviderCredentials(): ProviderCredentialsResponse {
  return {
    providers: PROVIDER_CREDENTIALS.map(({ provider, envKey }) => ({
      provider,
      configured: isProviderConfigured(envKey),
    })),
  };
}

export async function setProviderCredential(
  provider: string,
  apiKey: string,
): Promise<ProviderCredentialStatus> {
  const credential = getSupportedProviderCredential(provider);
  if (!credential) throw new ConfigurationNotFoundError('provider', provider);

  const validationError = validateApiKeyValue(apiKey);
  if (validationError) throw new ConfigurationValidationError(validationError);

  try {
    const content = await readFileSafe(getEnvFilePath());
    const merged = mergeEnvLine(content, credential.envKey, apiKey.trim());
    await atomicWriteFile(getEnvFilePath(), merged.content);
    reloadJean2Env();
    return { provider, configured: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to set credential for ${provider}: ${message}`);
  }
}

export async function clearProviderCredential(provider: string): Promise<ProviderCredentialStatus> {
  const credential = getSupportedProviderCredential(provider);
  if (!credential) throw new ConfigurationNotFoundError('provider', provider);

  try {
    const content = await readFileSafe(getEnvFilePath());
    if (!content) {
      reloadJean2Env();
      return { provider, configured: false };
    }

    await atomicWriteFile(getEnvFilePath(), removeEnvLine(content, credential.envKey));
    reloadJean2Env();
    return { provider, configured: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to clear credential for ${provider}: ${message}`);
  }
}

function isProviderConfigured(envKey: string): boolean {
  const value = getJean2EnvValue(envKey);
  return value !== undefined && value !== '';
}
