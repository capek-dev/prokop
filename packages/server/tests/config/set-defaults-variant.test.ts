import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearModelsCache } from '@/config';
import { setDefaults } from '@/config/models';
import { ConfigurationValidationError } from '@/config/errors';

/**
 * setDefaults owns the stored default variant: a provided value must exist on
 * the default model, and omitting it (a model change) clears back to the
 * model's first (lowest) declared variant. Hermetic via MODELS_PATH fixture.
 */

const CATALOG = {
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'v4-pro', name: 'V4 Pro', contextWindow: 1000, variants: { high: { providerOptions: {} }, max: { providerOptions: {} } } },
        { id: 'flash', name: 'Flash', contextWindow: 1000, variants: { high: { providerOptions: {} }, max: { providerOptions: {} } } },
        { id: 'plain', name: 'Plain', contextWindow: 1000 },
      ],
    },
  ],
  defaultModel: 'flash',
  defaultProvider: 'deepseek',
};

let fixtureDir: string;
let catalogPath: string;
const savedPaths: Record<string, string | undefined> = {};

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'defaults-catalog-'));
  catalogPath = join(fixtureDir, 'models.json');
  writeFileSync(catalogPath, JSON.stringify(CATALOG));
  for (const key of ['PROKOPAI_MODELS_PATH', 'JEAN2_MODELS_PATH', 'MODELS_PATH']) {
    savedPaths[key] = process.env[key];
    process.env[key] = catalogPath;
  }
  clearModelsCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedPaths)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearModelsCache();
  rmSync(fixtureDir, { recursive: true, force: true });
});

function readStored(): unknown {
  return JSON.parse(readFileSync(catalogPath, 'utf-8'));
}

test('a valid default variant is stored and echoed', async () => {
  const result = await setDefaults({ defaultProvider: 'deepseek', defaultModel: 'v4-pro', defaultVariant: 'max' });
  expect(result.defaultVariant).toBe('max');
  expect((readStored() as { defaultVariant?: string }).defaultVariant).toBe('max');
});

test('a variant missing from the default model is rejected', async () => {
  await expect(setDefaults({ defaultProvider: 'deepseek', defaultModel: 'v4-pro', defaultVariant: 'xhigh' }))
    .rejects.toThrow(ConfigurationValidationError);
  await expect(setDefaults({ defaultProvider: 'deepseek', defaultModel: 'plain', defaultVariant: 'high' }))
    .rejects.toThrow(ConfigurationValidationError);
});

test('omitting the variant clears a stored default back to the first key', async () => {
  await setDefaults({ defaultProvider: 'deepseek', defaultModel: 'v4-pro', defaultVariant: 'max' });
  await setDefaults({ defaultProvider: 'deepseek', defaultModel: 'v4-pro' });
  expect((readStored() as { defaultVariant?: string | null }).defaultVariant).toBeNull();
});
