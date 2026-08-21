import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import type { Preconfig } from '@prokopai/sdk';
import {
  createPreconfig,
  getPreconfig,
  getPreconfigJsonPath,
  getPreconfigMdPath,
  updatePreconfig,
} from '@/infrastructure/config/preconfig';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

function createInput(id: string): Omit<Preconfig, 'id'> & { id: string } {
  return {
    id,
    name: id,
    description: '',
    systemPrompt: 'Test prompt',
    tools: null,
    model: null,
    provider: null,
    settings: null,
    isDefault: false,
    mode: 'both',
    canSpawnSubagents: true,
    skills: null,
  };
}

describe('preconfig self-subagent persistence', () => {
  beforeEach(() => {
    setupTestDataDir();
  });

  afterEach(() => {
    resetTestDataDir();
  });

  test('JSON create and update preserve explicit values', async () => {
    await createPreconfig({
      ...createInput('json-preconfig'),
      allowSelfAsSubagent: true,
    });

    expect((await getPreconfig('json-preconfig'))?.allowSelfAsSubagent).toBe(true);

    await updatePreconfig('json-preconfig', { allowSelfAsSubagent: false });

    expect((await getPreconfig('json-preconfig'))?.allowSelfAsSubagent).toBe(false);
    const stored = JSON.parse(await readFile(getPreconfigJsonPath('json-preconfig'), 'utf-8')) as Preconfig;
    expect(stored.allowSelfAsSubagent).toBe(false);
  });

  test('Markdown create and update preserve explicit values', async () => {
    await createPreconfig({
      ...createInput('markdown-preconfig'),
      allowSelfAsSubagent: true,
    }, 'md');

    expect((await getPreconfig('markdown-preconfig'))?.allowSelfAsSubagent).toBe(true);

    await updatePreconfig('markdown-preconfig', { allowSelfAsSubagent: false });

    expect((await getPreconfig('markdown-preconfig'))?.allowSelfAsSubagent).toBe(false);
    const stored = await readFile(getPreconfigMdPath('markdown-preconfig'), 'utf-8');
    expect(stored).toContain('allowSelfAsSubagent: false');
  });

  test('missing values normalize to false on create', async () => {
    const jsonPreconfig = await createPreconfig(createInput('json-default'));
    const markdownPreconfig = await createPreconfig(createInput('markdown-default'), 'md');

    expect(jsonPreconfig.allowSelfAsSubagent).toBe(false);
    expect(markdownPreconfig.allowSelfAsSubagent).toBe(false);
    expect((await getPreconfig('json-default'))?.allowSelfAsSubagent).toBe(false);
    expect((await getPreconfig('markdown-default'))?.allowSelfAsSubagent).toBe(false);
  });
});
