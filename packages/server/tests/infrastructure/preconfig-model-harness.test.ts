import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  createPreconfig,
  getPreconfig,
  getPreconfigSync,
  listPreconfigs,
  updatePreconfig,
} from '@/infrastructure/config/preconfig';
import {
  createValidatedPreconfig,
  updateValidatedPreconfig,
  validatePreconfigData,
} from '@/config/preconfigs';
import { resetTestDataDir, getTestDataDir, setupTestDataDir } from '#tests/test-dir';

// modelHarness round-trips through md and json storage, is coerced to null at
// every read exit when the stored value is unknown or malformed, and the
// validated write layer accepts harness pins whose models live in a CLI
// catalog instead of the Prokop models.json catalog.

function basePreconfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Pinned',
    description: '',
    systemPrompt: '',
    tools: null,
    model: 'gpt-5.2-codex',
    provider: null,
    variant: 'low',
    modelHarness: 'codex-cli',
    settings: null,
    isDefault: false,
    ...overrides,
  };
}

describe('preconfig modelHarness storage', () => {
  beforeEach(() => {
    setupTestDataDir();
  });

  afterEach(() => {
    resetTestDataDir();
  });

  test('round-trips through markdown frontmatter and updates', async () => {
    const created = await createPreconfig(basePreconfig() as never, 'md');
    expect(created.modelHarness).toBe('codex-cli');

    expect((await getPreconfig(created.id))?.modelHarness).toBe('codex-cli');
    expect(getPreconfigSync(created.id)?.modelHarness).toBe('codex-cli');

    const updated = await updatePreconfig(created.id, { modelHarness: 'claude-cli' });
    expect(updated?.modelHarness).toBe('claude-cli');
    expect((await getPreconfig(created.id))?.modelHarness).toBe('claude-cli');
  });

  test('round-trips through json storage', async () => {
    const created = await createPreconfig(basePreconfig({ id: 'pinned-json' }) as never);
    expect(created.modelHarness).toBe('codex-cli');
    expect((await getPreconfig('pinned-json'))?.modelHarness).toBe('codex-cli');
  });

  test('coerces an unknown stored value to null at the read exits', async () => {
    const dir = join(getTestDataDir()!, 'preconfigs');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pinned-bogus.md'),
      `---\nname: Pinned\ndescription: ''\nmodel: m\nmodelHarness: openai-claude-hybrid\n---\n\nprompt\n`,
    );

    expect((await getPreconfig('pinned-bogus'))?.modelHarness).toBeNull();
    expect(getPreconfigSync('pinned-bogus')?.modelHarness).toBeNull();
    expect((await listPreconfigs()).find(p => p.id === 'pinned-bogus')?.modelHarness).toBeNull();
  });

  // The validated write layer (the PUT /api/preconfigs path) used to require
  // every pinned model to exist in the Prokop models.json catalog, so saving
  // a harness pin 400'd with `model "<id>" does not exist`.
  describe('validated layer', () => {
    const base = {
      name: 'Pinned',
      description: '',
      systemPrompt: '',
      tools: null,
      provider: null,
      settings: null,
      isDefault: false,
    };

    test('accepts a harness pin whose model is not in the Prokop catalog', async () => {
      const created = await createValidatedPreconfig({
        ...base,
        model: 'gpt-5.2-codex',
        variant: 'medium',
        modelHarness: 'codex-cli',
      } as never, 'md');

      expect(created.modelHarness).toBe('codex-cli');
      expect(created.model).toBe('gpt-5.2-codex');

      const updated = await updateValidatedPreconfig(created.id, {
        model: 'claude-opus-4-6',
        variant: 'high',
        modelHarness: 'claude-cli',
      } as never);
      expect(updated?.modelHarness).toBe('claude-cli');
      expect(updated?.model).toBe('claude-opus-4-6');
    });

    test('still rejects a prokop pin that is not in the catalog', () => {
      const errors = validatePreconfigData({
        ...base, model: 'no-such-model', provider: null, modelHarness: 'prokop',
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('does not exist in current models configuration');
    });

    test('rejects an unknown modelHarness value', () => {
      const errors = validatePreconfigData({
        ...base, model: 'gpt-5.2-codex', modelHarness: 'openai',
      });
      expect(errors).toEqual(['modelHarness must be one of: prokop, codex-cli, claude-cli']);
    });
  });
});
