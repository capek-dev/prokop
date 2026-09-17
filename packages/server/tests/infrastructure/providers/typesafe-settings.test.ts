import { afterEach, beforeEach, expect, test } from 'bun:test';
import { executeMemoryTool, withRuntimeHost } from '@capekai/core/hosts';
import { jean2CompatibilityBindings } from '@/adapters/capek/bindings';
import { getDataDir } from '@/infrastructure/runtime/paths';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { getJean2EnvValue, reloadJean2Env, wasEnvInjectedFromFile } from '@/infrastructure/runtime/environment';
import { clearProviderCredential, setProviderCredential, getContextSelectionSettings, setContextSelectionEnabled, listProviderCredentials } from '@/infrastructure/providers/provider-credential-files';

const keys = ['PROKOPAI_TYPESAFE_API_KEY', 'JEAN2_TYPESAFE_API_KEY', 'PROKOPAI_CONTEXT_SELECTION_ENABLED', 'JEAN2_CONTEXT_SELECTION_ENABLED',
  'PROKOPAI_CONTEXT_SELECTION_MINIMUM_LEVEL', 'JEAN2_CONTEXT_SELECTION_MINIMUM_LEVEL',
  'PROKOPAI_CONTEXT_SELECTION_REQUIRED_PROBABILITY', 'JEAN2_CONTEXT_SELECTION_REQUIRED_PROBABILITY'];
let saved: Array<{ key: string; value?: string; injected: boolean }>;
beforeEach(() => {
  saved = keys.map(key => ({ key, value: process.env[key], injected: wasEnvInjectedFromFile(key) }));
  setupTestDataDir();
  reloadJean2Env();
  for (const key of keys) delete process.env[key];
});
afterEach(() => {
  for (const key of keys) delete process.env[key];
  reloadJean2Env();
  resetTestDataDir();
  for (const { key, value, injected } of saved) if (!injected && value !== undefined) process.env[key] = value;
  reloadJean2Env();
});

test('published core memory capacity follows the experimental toggle without restart', async () => {
  await withRuntimeHost(jean2CompatibilityBindings, async () => {
    const dir = getDataDir();
    const list = () => executeMemoryTool({ action: 'list', target: 'memory' }, dir, 'none');
    expect((await list()).result?.usage.limit).toBe(2500);
    await setProviderCredential('typesafe', 'fake');
    await setContextSelectionEnabled(true);
    expect((await executeMemoryTool({ action: 'add', target: 'memory', content: 'x'.repeat(49998) }, dir, 'none')).success).toBe(true);
    expect((await list()).result?.usage).toEqual({ chars: 50000, limit: 50000 });
    expect((await executeMemoryTool({ action: 'list', target: 'user' }, dir, 'none')).result?.usage.limit).toBe(1500);
    await setContextSelectionEnabled(false);
    expect((await list()).result?.usage).toEqual({ chars: 50000, limit: 2500 });
  });
});

const defaults = { minimumLevel: 2, requiredProbability: 0.7 };

test('concurrent credential and flag edits preserve order without resurrecting a removed key', async () => {
  await Promise.all([setProviderCredential('typesafe', 'first-key'), setContextSelectionEnabled(true)]);
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: true, configured: true });
  const results = await Promise.allSettled([clearProviderCredential('typesafe'), setContextSelectionEnabled(true)]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: true, configured: false });
  await setContextSelectionEnabled(false);
  expect(getContextSelectionSettings().enabled).toBe(false);
});

test('TypeSafe setup does not opt in; toggles persist and keys never appear in status', async () => {
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: false, configured: false });
  await expect(setContextSelectionEnabled(true)).rejects.toThrow('Configure TypeSafe');
  await setProviderCredential('typesafe', 'test-secret');
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: false, configured: true });
  expect(listProviderCredentials().providers.find(item => item.provider === 'typesafe')).toEqual({ provider: 'typesafe', configured: true });
  expect(await setContextSelectionEnabled(true)).toEqual({ ...defaults, enabled: true, configured: true });
  reloadJean2Env();
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: true, configured: true });
  await clearProviderCredential('typesafe');
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: true, configured: false });
  expect(await setContextSelectionEnabled(false)).toEqual({ ...defaults, enabled: false, configured: false });
});

test('partial concurrent policy writes persist without overwriting credentials or toggle', async () => {
  await Promise.all([
    setProviderCredential('typesafe', 'fake'), setContextSelectionEnabled(true),
    setContextSelectionEnabled({ minimumLevel: 3 }), setContextSelectionEnabled({ requiredProbability: 0.8 }),
  ]);
  reloadJean2Env();
  expect(getContextSelectionSettings()).toEqual({ enabled: true, configured: true, minimumLevel: 3, requiredProbability: 0.8 });
  await setContextSelectionEnabled(false);
  expect(getContextSelectionSettings()).toEqual({ enabled: false, configured: true, minimumLevel: 3, requiredProbability: 0.8 });
});

test('malformed policy rejects atomically and invalid environment values use defaults', async () => {
  for (const minimumLevel of [-1, 4, 1.5, NaN]) await expect(setContextSelectionEnabled({ minimumLevel, requiredProbability: 0.9 })).rejects.toThrow();
  for (const requiredProbability of [-1, 2, Infinity, NaN]) await expect(setContextSelectionEnabled({ requiredProbability })).rejects.toThrow();
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: false, configured: false });
  process.env.PROKOPAI_CONTEXT_SELECTION_MINIMUM_LEVEL = '2oops';
  process.env.PROKOPAI_CONTEXT_SELECTION_REQUIRED_PROBABILITY = 'bad';
  expect(getContextSelectionSettings()).toEqual({ ...defaults, enabled: false, configured: false });
  await setContextSelectionEnabled({ minimumLevel: 0, requiredProbability: 0 });
  expect(getContextSelectionSettings()).toEqual({ minimumLevel: 0, requiredProbability: 0, enabled: false, configured: false });
});

test('settings override inherited process values immediately and reject malformed input', async () => {
  process.env.PROKOPAI_TYPESAFE_API_KEY = 'inherited-key';
  await clearProviderCredential('typesafe');
  expect(getContextSelectionSettings().configured).toBe(false);
  expect(getJean2EnvValue('PROKOPAI_TYPESAFE_API_KEY')).toBe('');
  process.env.PROKOPAI_CONTEXT_SELECTION_ENABLED = 'true';
  await setContextSelectionEnabled(false);
  expect(process.env.PROKOPAI_CONTEXT_SELECTION_ENABLED).toBe('true');
  expect(getJean2EnvValue('PROKOPAI_CONTEXT_SELECTION_ENABLED')).toBe('false');
  await expect(setContextSelectionEnabled('true' as unknown as boolean)).rejects.toThrow('Invalid context selection settings');
  await expect(setProviderCredential('typesafe', 'key\nPROKOPAI_CONTEXT_SELECTION_ENABLED=true')).rejects.toThrow('single line');
});
