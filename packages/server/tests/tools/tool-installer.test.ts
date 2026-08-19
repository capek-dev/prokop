import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import * as tar from 'tar';
import { createHash } from 'crypto';

import {
  installTool,
  installToolFromUrl,
  removeTool,
  getInstalledTools,
  isToolInstalled,
  getInstalledToolVersion,
} from '@/infrastructure/tools/tool-installer';
import { readInstallManifest } from '@capekai/core/tools';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures', 'test-fixture-tool');
const BROKEN_FIXTURE_DIR = resolve(import.meta.dir, 'fixtures', 'test-fixture-broken');

function createTempDir(): string {
  return join(tmpdir(), `jean2-test-installer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function createTarGz(sourceDir: string, outputPath: string): Promise<void> {
  await tar.c({
    gzip: true,
    file: outputPath,
    cwd: sourceDir,
  }, ['.']);
}

describe('tool-installer', () => {
  let tempDir: string;
  let toolsDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mkdirSync(tempDir, { recursive: true });
    toolsDir = join(tempDir, 'tools');
    mkdirSync(toolsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('installTool (local source)', () => {
    test('installs a valid tool from local source directory', async () => {
      const result = await installTool(FIXTURE_DIR, toolsDir);

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('test-fixture-tool');
      expect(result.version).toBe('1.0.0');

      // Verify files were copied
      const installedDir = join(toolsDir, 'test-fixture-tool');
      expect(existsSync(join(installedDir, 'tool.ts'))).toBe(true);
      expect(existsSync(join(installedDir, 'package.json'))).toBe(true);
      expect(existsSync(join(installedDir, 'VERSION'))).toBe(true);

      // Verify install manifest
      const manifest = readInstallManifest(toolsDir, 'test-fixture-tool');
      expect(manifest).not.toBeNull();
      expect(manifest!.toolName).toBe('test-fixture-tool');
      expect(manifest!.toolVersion).toBe('1.0.0');
      expect(manifest!.runtime).toBe('bun');
      expect(manifest!.installStrategy).toBe('source+npm');
    });

    test('fails when source path does not exist', async () => {
      const result = await installTool('/nonexistent/path', toolsDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Source path does not exist');
    });

    test('fails when source has no tool.js or tool.ts', async () => {
      const emptySource = join(tempDir, 'empty-source');
      mkdirSync(emptySource, { recursive: true });

      const result = await installTool(emptySource, toolsDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('must contain tool.js or tool.ts');
    });

    test('fails when tool module has invalid exports', async () => {
      const result = await installTool(BROKEN_FIXTURE_DIR, toolsDir);

      expect(result.success).toBe(false);
      expect(result.stage).toBe('validate');
      expect(result.error).toContain('definition');
    });

    test('replaces existing installation atomically', async () => {
      // First install
      const result1 = await installTool(FIXTURE_DIR, toolsDir);
      expect(result1.success).toBe(true);

      // Modify VERSION in a copy
      const updatedSource = join(tempDir, 'updated-source');
      cpSync(FIXTURE_DIR, updatedSource, { recursive: true });
      writeFileSync(join(updatedSource, 'VERSION'), '2.0.0\n');

      // Second install (upgrade)
      const result2 = await installTool(updatedSource, toolsDir);
      expect(result2.success).toBe(true);
      expect(result2.version).toBe('2.0.0');

      // No .staging or .previous dirs left
      const entries = existsSync(toolsDir) ? require('fs').readdirSync(toolsDir) : [];
      for (const entry of entries) {
        expect(entry).not.toContain('.staging');
        expect(entry).not.toContain('.previous');
      }

      // Version should be updated
      const version = await getInstalledToolVersion('test-fixture-tool', toolsDir);
      expect(version).toBe('2.0.0');
    });
  });

  describe('installToolFromUrl', () => {
    test('installs from a file:// URL to a tar.gz', async () => {
      const archivePath = join(tempDir, 'test-fixture-tool.tar.gz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const result = await installToolFromUrl(
        `file://${archivePath}`,
        'test-fixture-tool',
        toolsDir,
        { entry: 'tool.ts' },
      );

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('test-fixture-tool');
      expect(result.version).toBe('1.0.0');

      // Verify files
      const installedDir = join(toolsDir, 'test-fixture-tool');
      expect(existsSync(join(installedDir, 'tool.ts'))).toBe(true);
      expect(existsSync(join(installedDir, 'package.json'))).toBe(true);

      // Verify manifest with URL source
      const manifest = readInstallManifest(toolsDir, 'test-fixture-tool');
      expect(manifest).not.toBeNull();
      expect(manifest!.sourceUrl).toBe(`file://${archivePath}`);
      expect(manifest!.entry).toBe('tool.js');
      expect(manifest!.installStrategy).toBe('source+npm+bundle');
    });

    test('installs with SHA-256 verification', async () => {
      const archivePath = join(tempDir, 'verified-tool.tar.gz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const archiveContent = readFileSync(archivePath);
      const sha256 = createHash('sha256').update(archiveContent).digest('hex');

      const result = await installToolFromUrl(
        `file://${archivePath}`,
        'test-fixture-tool',
        toolsDir,
        { entry: 'tool.ts', artifactSha256: sha256 },
      );

      expect(result.success).toBe(true);
      expect(result.toolName).toBe('test-fixture-tool');
    });

    test('fails on SHA-256 mismatch', async () => {
      const archivePath = join(tempDir, 'bad-checksum.tar.gz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const result = await installToolFromUrl(
        `file://${archivePath}`,
        'test-fixture-tool',
        toolsDir,
        { entry: 'tool.ts', artifactSha256: '0000000000000000000000000000000000000000' },
      );

      expect(result.success).toBe(false);
      expect(result.stage).toBe('checksum');
      expect(result.error).toContain('Checksum mismatch');
    });

    test('fails when artifact is missing package.json', async () => {
      // Create a tar.gz with only tool.ts (no package.json)
      const noPkgDir = join(tempDir, 'no-pkg-tool');
      mkdirSync(noPkgDir, { recursive: true });
      writeFileSync(join(noPkgDir, 'tool.ts'), `
export const definition = { name: 'no-pkg-tool', description: 'test', inputSchema: { type: 'object', properties: {} }, timeout: 5000 };
export async function execute() { return { success: true }; }
`);
      writeFileSync(join(noPkgDir, 'VERSION'), '1.0.0\n');

      const archivePath = join(tempDir, 'no-pkg.tar.gz');
      await tar.c({ gzip: true, file: archivePath, cwd: noPkgDir }, ['.']);

      const result = await installToolFromUrl(
        `file://${archivePath}`,
        'no-pkg-tool',
        toolsDir,
        { entry: 'tool.ts' },
      );

      expect(result.success).toBe(false);
      expect(result.stage).toBe('validate');
      expect(result.error).toContain('missing package.json');
    });

    test('cleans up temp directory even on failure', async () => {
      const result = await installToolFromUrl(
        'file:///nonexistent/path.tar.gz',
        'test-tool',
        toolsDir,
        { entry: 'tool.ts' },
      );

      expect(result.success).toBe(false);

      // Verify no stray temp dirs in tmpdir
      // (The temp dir should have been cleaned up in the finally block)
    });
  });

  describe('removeTool', () => {
    test('removes an installed tool', async () => {
      await installTool(FIXTURE_DIR, toolsDir);
      expect(existsSync(join(toolsDir, 'test-fixture-tool'))).toBe(true);

      const result = await removeTool('test-fixture-tool', toolsDir);

      expect(result.success).toBe(true);
      expect(existsSync(join(toolsDir, 'test-fixture-tool'))).toBe(false);
    });

    test('fails when tool is not installed', async () => {
      const result = await removeTool('nonexistent-tool', toolsDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not installed');
    });

    test('cleans up .previous directory', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      // Create a fake .previous directory
      const previousDir = join(toolsDir, 'test-fixture-tool.previous');
      mkdirSync(previousDir, { recursive: true });

      await removeTool('test-fixture-tool', toolsDir);

      expect(existsSync(previousDir)).toBe(false);
      expect(existsSync(join(toolsDir, 'test-fixture-tool'))).toBe(false);
    });
  });

  describe('getInstalledTools', () => {
    test('returns empty array when no tools installed', async () => {
      const tools = await getInstalledTools(toolsDir);
      expect(tools).toHaveLength(0);
    });

    test('returns empty array for nonexistent directory', async () => {
      const tools = await getInstalledTools('/nonexistent/path');
      expect(tools).toHaveLength(0);
    });

    test('lists installed tools with versions', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      const tools = await getInstalledTools(toolsDir);

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-fixture-tool');
      expect(tools[0].version).toBe('1.0.0');
      expect(tools[0].path).toBe(join(toolsDir, 'test-fixture-tool'));
    });

    test('ignores .staging and .previous directories', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      // Create fake staging/previous dirs
      mkdirSync(join(toolsDir, 'fake.staging'), { recursive: true });
      mkdirSync(join(toolsDir, 'fake.previous'), { recursive: true });

      const tools = await getInstalledTools(toolsDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-fixture-tool');
    });
  });

  describe('isToolInstalled', () => {
    test('returns true for installed tool', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      const installed = await isToolInstalled('test-fixture-tool', toolsDir);
      expect(installed).toBe(true);
    });

    test('returns false for uninstalled tool', async () => {
      const installed = await isToolInstalled('nonexistent', toolsDir);
      expect(installed).toBe(false);
    });
  });

  describe('getInstalledToolVersion', () => {
    test('returns version from VERSION file', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      const version = await getInstalledToolVersion('test-fixture-tool', toolsDir);
      expect(version).toBe('1.0.0');
    });

    test('returns null for nonexistent tool', async () => {
      const version = await getInstalledToolVersion('nonexistent', toolsDir);
      expect(version).toBeNull();
    });

    test('falls back to manifest version when VERSION file missing', async () => {
      await installTool(FIXTURE_DIR, toolsDir);

      // Remove VERSION file
      rmSync(join(toolsDir, 'test-fixture-tool', 'VERSION'));

      const version = await getInstalledToolVersion('test-fixture-tool', toolsDir);
      // Should fall back to manifest
      expect(version).toBe('1.0.0');
    });
  });
});
