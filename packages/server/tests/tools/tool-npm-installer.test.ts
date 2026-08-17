import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  installDependencies,
  NpmInstallError,
} from '@/infrastructure/tools/tool-npm-installer';

function createTempDir(): string {
  return join(tmpdir(), `jean2-test-npm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe('tool-npm-installer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('installDependencies', () => {
    test('returns success with count 0 when no package.json exists', async () => {
      const emptyDir = join(tempDir, 'no-pkg');
      mkdirSync(emptyDir, { recursive: true });

      const result = await installDependencies({ toolDir: emptyDir });

      expect(result.success).toBe(true);
      expect(result.installedCount).toBe(0);
    });

    test('returns success with count 0 when package.json has no dependencies', async () => {
      const toolDir = join(tempDir, 'empty-deps');
      mkdirSync(toolDir, { recursive: true });
      writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
        name: 'test-tool',
        version: '1.0.0',
        dependencies: {},
      }));

      const result = await installDependencies({ toolDir });

      expect(result.success).toBe(true);
      expect(result.installedCount).toBe(0);
      expect(result.packageJson).toBeDefined();
      expect(result.packageJson!.name).toBe('test-tool');
    });

    test('returns success when package.json has no dependencies field', async () => {
      const toolDir = join(tempDir, 'no-deps-field');
      mkdirSync(toolDir, { recursive: true });
      writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
        name: 'test-tool',
        version: '1.0.0',
      }));

      const result = await installDependencies({ toolDir });

      expect(result.success).toBe(true);
      expect(result.installedCount).toBe(0);
    });

    test('throws NpmInstallError for corrupted package.json', async () => {
      const toolDir = join(tempDir, 'bad-pkg');
      mkdirSync(toolDir, { recursive: true });
      writeFileSync(join(toolDir, 'package.json'), 'not valid json');

      try {
        await installDependencies({ toolDir });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NpmInstallError);
        expect((err as NpmInstallError).message).toContain('Failed to parse package.json');
      }
    });

    test('installs a real npm dependency using Arborist', async () => {
      const toolDir = join(tempDir, 'with-dep');
      mkdirSync(toolDir, { recursive: true });

      // Use a tiny, stable npm package
      writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
        name: 'test-tool-with-dep',
        version: '1.0.0',
        type: 'module',
        dependencies: {
          'emoji-regex': '^10.4.0',
        },
      }));

      const cacheDir = join(tempDir, 'npm-cache');
      mkdirSync(cacheDir, { recursive: true });

      const result = await installDependencies({
        toolDir,
        cacheDir,
      });

      expect(result.success).toBe(true);
      expect(result.packageJson).toBeDefined();
      expect(result.packageJson!.dependencies).toHaveProperty('emoji-regex');

      // Verify node_modules was created with the package
      expect(existsSync(join(toolDir, 'node_modules'))).toBe(true);
      expect(existsSync(join(toolDir, 'node_modules', 'emoji-regex'))).toBe(true);
    });

    test('respects custom registry option', async () => {
      const toolDir = join(tempDir, 'custom-registry');
      mkdirSync(toolDir, { recursive: true });
      writeFileSync(join(toolDir, 'package.json'), JSON.stringify({
        name: 'test-tool',
        version: '1.0.0',
        dependencies: {},
      }));

      const result = await installDependencies({
        toolDir,
        registry: 'https://registry.npmjs.org',
      });

      expect(result.success).toBe(true);
    });
  });
});
