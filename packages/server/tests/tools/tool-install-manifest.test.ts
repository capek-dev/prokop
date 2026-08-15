import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  readInstallManifest,
  writeInstallManifest,
  getManifestPath,
  type InstallManifest,
} from '@capekai/core/compat/jean2';

const FIXTURE_MANIFEST: InstallManifest = {
  toolName: 'test-tool',
  toolVersion: '1.2.3',
  installedAt: '2025-01-15T10:00:00.000Z',
  sourcePath: '/some/source/path',
  entry: 'tool.ts',
  runtime: 'bun',
  installStrategy: 'source+npm',
};

describe('tool-install-manifest', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `jean2-test-manifest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('writeInstallManifest', () => {
    test('writes .install-manifest.json to tool directory', () => {
      writeInstallManifest(tempDir, FIXTURE_MANIFEST);

      const manifestPath = join(tempDir, '.install-manifest.json');
      expect(existsSync(manifestPath)).toBe(true);

      const written = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(written.toolName).toBe('test-tool');
      expect(written.toolVersion).toBe('1.2.3');
      expect(written.runtime).toBe('bun');
      expect(written.installStrategy).toBe('source+npm');
    });

    test('overwrites existing manifest', () => {
      writeInstallManifest(tempDir, FIXTURE_MANIFEST);

      const updated: InstallManifest = {
        ...FIXTURE_MANIFEST,
        toolVersion: '2.0.0',
      };
      writeInstallManifest(tempDir, updated);

      const written = JSON.parse(readFileSync(getManifestPath(tempDir), 'utf-8'));
      expect(written.toolVersion).toBe('2.0.0');
    });
  });

  describe('readInstallManifest', () => {
    test('returns null when no manifest exists', () => {
      const result = readInstallManifest(tempDir, 'nonexistent-tool');
      expect(result).toBeNull();
    });

    test('returns manifest when it exists', () => {
      const toolDir = join(tempDir, 'my-tool');
      mkdirSync(toolDir, { recursive: true });
      writeInstallManifest(toolDir, FIXTURE_MANIFEST);

      const result = readInstallManifest(tempDir, 'my-tool');
      expect(result).not.toBeNull();
      expect(result!.toolName).toBe('test-tool');
      expect(result!.toolVersion).toBe('1.2.3');
    });

    test('returns null for corrupted manifest JSON', () => {
      const toolDir = join(tempDir, 'corrupted-tool');
      mkdirSync(toolDir, { recursive: true });

      const manifestPath = join(toolDir, '.install-manifest.json');
      writeFileSync(manifestPath, 'not valid json {{{');

      const result = readInstallManifest(tempDir, 'corrupted-tool');
      expect(result).toBeNull();
    });
  });

  describe('getManifestPath', () => {
    test('returns correct path', () => {
      expect(getManifestPath('/tools/my-tool')).toBe('/tools/my-tool/.install-manifest.json');
    });
  });

  describe('manifest with all fields', () => {
    test('round-trips manifest with sourceUrl and artifactSha256', () => {
      const toolDir = join(tempDir, 'full-tool');
      mkdirSync(toolDir, { recursive: true });

      const fullManifest: InstallManifest = {
        toolName: 'full-tool',
        toolVersion: '3.0.0',
        installedAt: '2025-06-01T12:00:00.000Z',
        sourceUrl: 'https://github.com/example/tool.tar.gz',
        artifactSha256: 'deadbeef12345678',
        entry: 'tool.ts',
        runtime: 'bun',
        packageName: '@jean2/tool-full',
        packageVersion: '3.0.0',
        installStrategy: 'source+npm',
      };

      writeInstallManifest(toolDir, fullManifest);
      const result = readInstallManifest(tempDir, 'full-tool');

      expect(result).not.toBeNull();
      expect(result!.toolName).toBe('full-tool');
      expect(result!.toolVersion).toBe('3.0.0');
      expect(result!.sourceUrl).toBe('https://github.com/example/tool.tar.gz');
      expect(result!.artifactSha256).toBe('deadbeef12345678');
      expect(result!.packageName).toBe('@jean2/tool-full');
      expect(result!.packageVersion).toBe('3.0.0');
      expect(result!.entry).toBe('tool.ts');
      expect(result!.runtime).toBe('bun');
      expect(result!.installStrategy).toBe('source+npm');
    });
  });
});
