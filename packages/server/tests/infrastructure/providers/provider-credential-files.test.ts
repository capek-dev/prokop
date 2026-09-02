import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import {
  getJean2EnvValue,
  reloadJean2Env,
  wasEnvInjectedFromFile,
} from '@/infrastructure/runtime/environment';
import {
  clearProviderCredential,
  listProviderCredentials,
  setProviderCredential,
} from '@/infrastructure/providers/provider-credential-files';

const ENV_KEY = 'PROKOPAI_LLM_OPENAI_API_KEY';
const LEGACY_ENV_KEY = 'JEAN2_LLM_OPENAI_API_KEY';

interface SavedEnvValue {
  value: string | undefined;
  injectedFromFile: boolean;
}

describe('provider credential files', () => {
  let testDir: string;
  let savedCanonical: SavedEnvValue;
  let savedLegacy: SavedEnvValue;

  beforeEach(() => {
    savedCanonical = {
      value: process.env[ENV_KEY],
      injectedFromFile: wasEnvInjectedFromFile(ENV_KEY),
    };
    savedLegacy = {
      value: process.env[LEGACY_ENV_KEY],
      injectedFromFile: wasEnvInjectedFromFile(LEGACY_ENV_KEY),
    };

    testDir = setupTestDataDir();
    reloadJean2Env();
    delete process.env[ENV_KEY];
    delete process.env[LEGACY_ENV_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[LEGACY_ENV_KEY];
    reloadJean2Env();
    resetTestDataDir();

    if (!savedCanonical.injectedFromFile && savedCanonical.value !== undefined) {
      process.env[ENV_KEY] = savedCanonical.value;
    }
    if (!savedLegacy.injectedFromFile && savedLegacy.value !== undefined) {
      process.env[LEGACY_ENV_KEY] = savedLegacy.value;
    }
    reloadJean2Env();
  });

  test('clearing a file credential removes its runtime value and configured status', async () => {
    await setProviderCredential('openai', 'sk-test');

    expect(getJean2EnvValue(ENV_KEY)).toBe('sk-test');
    expect(listProviderCredentials().providers.find(({ provider }) => provider === 'openai')).toEqual({
      provider: 'openai',
      configured: true,
    });

    await clearProviderCredential('openai');

    expect(getJean2EnvValue(ENV_KEY)).toBeUndefined();
    expect(process.env[ENV_KEY]).toBeUndefined();
    expect(listProviderCredentials().providers.find(({ provider }) => provider === 'openai')).toEqual({
      provider: 'openai',
      configured: false,
    });
    expect(await readFile(join(testDir, '.env'), 'utf-8')).not.toContain(ENV_KEY);
  });
});
