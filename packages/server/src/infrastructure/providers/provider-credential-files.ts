import type { ProviderCredentialStatus, ProviderCredentialsResponse } from '@prokopai/sdk';
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
  legacyEnvKeyFor,
  mergeEnvLine,
  PROVIDER_CREDENTIALS,
  removeEnvLine,
  validateApiKeyValue,
} from '@/domains/provider-accounts';

export { getSupportedProviderCredential };

// Credential edits and the experimental flag share one file and must not overwrite each other.
let pendingWrite: Promise<unknown> = Promise.resolve();
function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = pendingWrite.then(write);
  pendingWrite = result.catch(() => {});
  return result;
}

export function setContextSelectionEnabled(enabled: boolean): Promise<{ enabled: boolean; configured: boolean }> {
  return serializeWrite(() => writeContextSelectionEnabled(enabled));
}
export function setProviderCredential(provider: string, apiKey: string): Promise<ProviderCredentialStatus> {
  return serializeWrite(() => writeProviderCredential(provider, apiKey));
}
export function clearProviderCredential(provider: string): Promise<ProviderCredentialStatus> {
  return serializeWrite(() => deleteProviderCredential(provider));
}

export function getContextSelectionSettings(): { enabled: boolean; configured: boolean } {
  return {
    enabled: getJean2EnvValue('PROKOPAI_CONTEXT_SELECTION_ENABLED') === 'true',
    configured: Boolean(getJean2EnvValue('PROKOPAI_TYPESAFE_API_KEY')?.trim()),
  };
}

async function writeContextSelectionEnabled(enabled: boolean): Promise<{ enabled: boolean; configured: boolean }> {
  if (typeof enabled !== 'boolean') throw new ConfigurationValidationError('enabled must be a boolean');
  if (enabled && !getContextSelectionSettings().configured) {
    throw new ConfigurationValidationError('Configure TypeSafe in LLM Providers first');
  }
  const content = await readFileSafe(getEnvFilePath());
  const merged = mergeEnvLine(content, 'PROKOPAI_CONTEXT_SELECTION_ENABLED', String(enabled));
  await atomicWriteFile(getEnvFilePath(), merged.content);
  reloadJean2Env();
  return getContextSelectionSettings();
}

export function listProviderCredentials(): ProviderCredentialsResponse {
  return {
    providers: PROVIDER_CREDENTIALS.map(({ provider, envKey }) => ({
      provider,
      configured: isProviderConfigured(envKey),
    })),
  };
}

async function writeProviderCredential(
  provider: string,
  apiKey: string,
): Promise<ProviderCredentialStatus> {
  const credential = getSupportedProviderCredential(provider);
  if (!credential) throw new ConfigurationNotFoundError('provider', provider);
  if (provider === 'typesafe' && /[\r\n]/.test(apiKey)) throw new ConfigurationValidationError('API key must be a single line');

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

async function deleteProviderCredential(provider: string): Promise<ProviderCredentialStatus> {
  const credential = getSupportedProviderCredential(provider);
  if (!credential) throw new ConfigurationNotFoundError('provider', provider);

  try {
    const content = await readFileSafe(getEnvFilePath());
    if (!content && provider !== 'typesafe') {
      reloadJean2Env();
      return { provider, configured: false };
    }

    // Clear the canonical key and the legacy twin: a stale JEAN2_* value
    // would resurrect the credential through the fallback read.
    let updated = removeEnvLine(content, credential.envKey);
    const legacyKey = legacyEnvKeyFor(credential.envKey);
    if (legacyKey) {
      updated = removeEnvLine(updated, legacyKey);
    }
    // An empty overlay prevents inherited process credentials from reappearing after removal.
    if (provider === 'typesafe') updated = mergeEnvLine(updated, credential.envKey, '').content;
    await atomicWriteFile(getEnvFilePath(), updated);
    reloadJean2Env();
    return { provider, configured: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigurationPersistenceError(`Failed to clear credential for ${provider}: ${message}`);
  }
}

function isProviderConfigured(envKey: string): boolean {
  const value = getJean2EnvValue(envKey);
  return Boolean(value?.trim());
}
