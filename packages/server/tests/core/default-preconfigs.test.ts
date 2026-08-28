import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  initializePreconfigs,
  listPreconfigs,
  getPreconfig,
} from '@/infrastructure/config/preconfig';
import { builtinTools, builtinToolNames } from '@/tools/builtin';
import { resetTestDataDir, setupTestDataDir } from '#tests/test-dir';

// The opinionated default set: initializePreconfigs writes these markdown
// preconfigs into a fresh data dir. This pins the contract the server
// ships with, through the real parser and the real builtin catalog.

describe('default preconfigs', () => {
  beforeEach(() => {
    setupTestDataDir();
  });

  afterEach(() => {
    resetTestDataDir();
  });

  test('installs exactly prokop-code and explore', async () => {
    await initializePreconfigs();

    const preconfigs = await listPreconfigs();
    expect(preconfigs.map((p) => p.id).sort()).toEqual(['explore', 'prokop-code']);
  });

  test('prokop-code is the default primary with every builtin tool', async () => {
    await initializePreconfigs();

    const prokopCode = await getPreconfig('prokop-code');
    expect(prokopCode).not.toBeNull();
    expect(prokopCode!.name).toBe('ProkopCode');
    expect(prokopCode!.isDefault).toBe(true);
    expect(prokopCode!.mode).toBe('primary');

    // Every builtin tool, and nothing the catalog does not know (the
    // catalog includes the terminal tool this default must expose).
    const toolNames = prokopCode!.tools ?? [];
    expect([...toolNames].sort()).toEqual([...builtinToolNames].sort());

    // Prompts must carry content, not just frontmatter.
    expect(prokopCode!.systemPrompt.length).toBeGreaterThan(200);
  });

  test('prokop-code spawns explore and may delegate to itself', async () => {
    await initializePreconfigs();

    const prokopCode = await getPreconfig('prokop-code');
    expect(prokopCode!.canSpawnSubagents).toEqual(['explore']);
    expect(prokopCode!.allowSelfAsSubagent).toBe(true);
  });

  test('explore is a subagent-only searcher with read-only tools', async () => {
    await initializePreconfigs();

    const explore = await getPreconfig('explore');
    expect(explore).not.toBeNull();
    expect(explore!.name).toBe('Explore');
    expect(explore!.mode).toBe('subagent');
    expect(explore!.isDefault).toBe(false);
    expect(explore!.canSpawnSubagents).toBe(false);
    expect(explore!.allowSelfAsSubagent).toBe(false);

    // Read-only toolset, all of which must be real catalog tools.
    const tools = explore!.tools ?? [];
    for (const tool of tools) {
      expect(builtinToolNames).toContain(tool);
    }
    expect(tools).toContain('read-file');
    expect(tools).toContain('grep');
    expect(tools).not.toContain('shell');
    expect(tools).not.toContain('write-file');
  });

  test('initializePreconfigs is idempotent and never overwrites existing files', async () => {
    await initializePreconfigs();

    // A user edit must survive re-initialization (per-file existence
    // check, never a delete).
    const modified = await updateAndGet();
    expect(modified).toBe(true);

    async function updateAndGet(): Promise<boolean> {
      const { updatePreconfig } = await import('@/infrastructure/config/preconfig');
      await updatePreconfig('explore', { description: 'user-edited' });
      await initializePreconfigs();
      const explore = await getPreconfig('explore');
      return explore!.description === 'user-edited';
    }
  });

  test('every default tool reference resolves in the builtin catalog', async () => {
    await initializePreconfigs();

    for (const preconfig of await listPreconfigs()) {
      for (const toolName of preconfig.tools ?? []) {
        const exists = builtinTools.some((tool) => tool.definition.name === toolName);
        expect({ preconfig: preconfig.id, toolName, exists }).toEqual({
          preconfig: preconfig.id,
          toolName,
          exists: true,
        });
      }
    }
  });
});
