import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Preconfig } from '@capekai/types';
import {
  buildWorkspaceSystemPrompt,
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  formatInstructions,
  getDefaultPreconfig,
  getPreconfigOrAgent,
  loadInstructions,
  readAgentMemoryFile,
} from '../src/context';

const root = join(process.cwd(), '.tmp-capek-context-test');
const preconfig = { id: 'agent', name: 'Agent', systemPrompt: 'base' } as Preconfig;

beforeEach(() => {
  configureAgentSource();
  configureInstructionSource();
  configurePreconfigSource();
});

afterEach(async () => {
  configureAgentSource();
  configureInstructionSource();
  configurePreconfigSource();
  await rm(root, { recursive: true, force: true });
});

describe('context sources', () => {
  test('defaults do not require Jean2 paths', async () => {
    expect(await getDefaultPreconfig()).toBeNull();
    expect(await getPreconfigOrAgent('agent')).toBeNull();
    expect(await readAgentMemoryFile('agent', 'USER.md')).toBeNull();
    expect(await loadInstructions()).toEqual({ global: null, project: null });
  });

  test('delegates preconfig and agent lookup without owning host layout', async () => {
    const calls: string[] = [];
    configurePreconfigSource({
      get: async (id) => { calls.push(`get:${id}`); return preconfig; },
      getDefault: async () => preconfig,
      getForAgent: async (id) => { calls.push(`agent:${id}`); return preconfig; },
      list: async () => [preconfig],
      listSubagents: async () => [preconfig],
    });
    configureAgentSource({
      getDirectory: async (id) => `/agents/${id}`,
      readMemoryFile: async (_id, file) => file,
    });
    expect(await getPreconfigOrAgent('agent')).toBe(preconfig);
    expect(await readAgentMemoryFile('agent', 'MEMORY.md')).toBe('MEMORY.md');
    expect(calls).toEqual(['agent:agent']);
  });

  test('loads and formats global before project and omits empty sections', async () => {
    await mkdir(root, { recursive: true });
    const globalPath = join(root, 'global.md');
    await writeFile(globalPath, ' global ');
    await writeFile(join(root, 'AGENTS.md'), ' project ');
    configureInstructionSource({ getGlobalPath: () => globalPath });
    const loaded = await loadInstructions(root);
    const formatted = formatInstructions(loaded) ?? '';
    expect(formatted.indexOf('source="global"')).toBeLessThan(formatted.indexOf('source="project"'));
    expect(formatted).toContain('\nglobal\n');
    expect(formatInstructions({ global: null, project: null })).toBeNull();
  });

  test('preserves workspace formatting and additional-path order', () => {
    const prompt = buildWorkspaceSystemPrompt('/workspace', ['/z', '/a']);
    expect(prompt.indexOf('- /z')).toBeLessThan(prompt.indexOf('- /a'));
    expect(prompt).toContain('Current workspace: /workspace');
  });
});
