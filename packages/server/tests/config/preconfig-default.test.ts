import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Preconfig } from '@prokopai/sdk';
import { createValidatedPreconfig, listValidatedPreconfigs, updateValidatedPreconfig } from '@/config/preconfigs';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

function input(id: string, isDefault: boolean): Omit<Preconfig, 'id'> & { id: string } {
  return {
    id,
    name: id,
    description: '',
    systemPrompt: '',
    tools: null,
    model: null,
    provider: null,
    settings: null,
    isDefault,
    mode: 'primary',
    skills: null,
  };
}

async function defaultIds(): Promise<string[]> {
  return (await listValidatedPreconfigs()).filter(p => p.isDefault).map(p => p.id);
}

describe('default preconfig', () => {
  beforeEach(() => {
    setupTestDataDir();
  });

  afterEach(() => {
    resetTestDataDir();
  });

  test('creating a default agent moves the default to it', async () => {
    await createValidatedPreconfig(input('first', true), 'md');
    await createValidatedPreconfig(input('second', true), 'md');

    expect(await defaultIds()).toEqual(['second']);
  });

  test('creating a non-default agent keeps the current default', async () => {
    await createValidatedPreconfig(input('first', true), 'md');
    await createValidatedPreconfig(input('second', false), 'md');

    expect(await defaultIds()).toEqual(['first']);
  });

  test('making an existing agent default moves the default instead of failing', async () => {
    await createValidatedPreconfig(input('first', true), 'md');
    await createValidatedPreconfig(input('second', false), 'md');

    await updateValidatedPreconfig('second', { isDefault: true });

    expect(await defaultIds()).toEqual(['second']);
  });
});
