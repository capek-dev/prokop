import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import {
  getManifestPath,
  readInstallManifest,
  writeInstallManifest,
  type InstallManifest,
} from '../src/tools/install-manifest';
import {
  clearCache,
  configureToolsPath,
  getTool,
  scanTools,
  stopWatching,
} from '../src/tools/registry';

const root = join(process.cwd(), '.tmp-capek-tool-registry');
const manifest = (entry: string): InstallManifest => ({
  toolName: 'example',
  toolVersion: '1.0.0',
  installedAt: '2025-01-01T00:00:00.000Z',
  entry,
  runtime: 'bun',
  installStrategy: 'source+npm',
});

beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  configureToolsPath(root);
  clearCache();
});

afterEach(async () => {
  stopWatching();
  clearCache();
  configureToolsPath();
  await rm(root, { recursive: true, force: true });
});

async function writeTool(path: string, name: string): Promise<void> {
  await writeFile(path, `export const definition = { name: '${name}', description: '${name}', inputSchema: { type: 'object', properties: {} } };\nexport async function execute() { return { success: true }; }\n`);
}

describe('install manifest', () => {
  test('round trips valid manifests and rejects malformed data', async () => {
    const toolDir = join(root, 'example');
    await mkdir(toolDir, { recursive: true });
    writeInstallManifest(toolDir, manifest('dist/tool.js'));

    expect(getManifestPath(toolDir)).toBe(join(toolDir, '.install-manifest.json'));
    expect(readInstallManifest(root, 'example')).toEqual(manifest('dist/tool.js'));

    const legacy = { ...manifest('dist/tool.js'), runtime: 'node', installStrategy: 'legacy' };
    await writeFile(getManifestPath(toolDir), JSON.stringify(legacy));
    expect(readInstallManifest(root, 'example')).toEqual(legacy as unknown as InstallManifest);

    await writeFile(getManifestPath(toolDir), '{"toolName":"example"}');
    expect(readInstallManifest(root, 'example')).toBeNull();
  });
});

describe('installed tool registry', () => {
  test('uses no Jean2 filesystem path until a host configures one', async () => {
    configureToolsPath();

    expect(await scanTools()).toEqual([]);
  });

  test('prefers manifest entry over tool.js and tool.ts', async () => {
    const toolDir = join(root, 'example');
    await mkdir(join(toolDir, 'dist'), { recursive: true });
    await writeTool(join(toolDir, 'dist', 'custom.ts'), 'manifest-tool');
    await writeTool(join(toolDir, 'tool.js'), 'javascript-tool');
    await writeTool(join(toolDir, 'tool.ts'), 'typescript-tool');
    writeInstallManifest(toolDir, manifest('dist/custom.ts'));

    const tools = await scanTools(root);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.definition.name).toBe('manifest-tool');
  });

  test('falls back from missing manifest entry to tool.js then tool.ts', async () => {
    const jsDir = join(root, 'javascript');
    const tsDir = join(root, 'typescript');
    await mkdir(jsDir, { recursive: true });
    await mkdir(tsDir, { recursive: true });
    await writeTool(join(jsDir, 'tool.js'), 'javascript-tool');
    await writeTool(join(jsDir, 'tool.ts'), 'ignored-typescript-tool');
    await writeTool(join(tsDir, 'tool.ts'), 'typescript-tool');
    writeInstallManifest(jsDir, manifest('missing.js'));

    const names = (await scanTools(root)).map((tool) => tool.definition.name).sort();
    expect(names).toEqual(['javascript-tool', 'typescript-tool']);
  });

  test('uses the configured default path and keeps valid cache entries', async () => {
    const toolDir = join(root, 'example');
    await mkdir(toolDir, { recursive: true });
    await writeTool(join(toolDir, 'tool.ts'), 'cached-tool');

    await scanTools(root);
    await rm(toolDir, { recursive: true, force: true });

    expect((await getTool('cached-tool'))?.definition.name).toBe('cached-tool');
  });

  test('fails soft for missing and invalid tool modules', async () => {
    await mkdir(join(root, 'missing'), { recursive: true });
    const invalidDir = join(root, 'invalid');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'tool.ts'), 'export const definition = {};');

    expect(await scanTools(root)).toEqual([]);
  });
});
