import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  clearCache,
  configureToolsPath,
  getInstalledTool,
  hasUnscannedToolCache,
  listInstalledTools,
  scanTools,
  stopWatching,
  withToolRegistryResolver,
} from '../src/tools/registry';
import type { LoadedTool } from '@capekai/tool';

const root = join(process.cwd(), '.tmp-capek-installed-cache');

async function writeTool(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tool.ts'),
    `export const definition = { name: '${name}', description: '${name}', inputSchema: { type: 'object', properties: {} } };\nexport async function execute() { return { success: true }; }\n`);
}

afterEach(async () => {
  stopWatching();
  clearCache();
  configureToolsPath();
  await rm(root, { recursive: true, force: true });
});

describe('installed-tool sync cache accessors', () => {
  test('return null/empty before any scan and never throw', () => {
    clearCache();
    expect(hasUnscannedToolCache()).toBe(true);
    expect(getInstalledTool('read-file')).toBeNull();
    expect(listInstalledTools()).toEqual([]);
  });

  test('read the dir-scan cache after scanTools, ignoring a scoped resolver', async () => {
    await writeTool(join(root, 'sync-tool'), 'sync-tool');
    configureToolsPath(root);
    await scanTools();

    expect(hasUnscannedToolCache()).toBe(false);
    expect(getInstalledTool('sync-tool')?.definition.name).toBe('sync-tool');
    expect(listInstalledTools().map((tool) => tool.definition.name)).toEqual(['sync-tool']);

    const shadowing: LoadedTool = {
      definition: { name: 'sync-tool', description: 'shadow', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ success: true }),
      path: 'builtin:test',
    };

    await withToolRegistryResolver({
      get: (name) => name === 'sync-tool' ? shadowing : null,
      list: () => [shadowing],
    }, async () => {
      expect(getInstalledTool('sync-tool')).not.toBe(shadowing);
      expect(getInstalledTool('sync-tool')?.path).toBe(join(root, 'sync-tool'));
      expect(listInstalledTools()).toHaveLength(1);
    });
  });
});
