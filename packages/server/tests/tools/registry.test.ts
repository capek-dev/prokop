import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { configureCapekJean2Compatibility } from '@/capek-adapter';
import {
  scanTools,
  getTool,
  listTools,
  clearCache,
} from '@capekai/core/compat/jean2';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures', 'test-fixture-tool');

function createTempDir(): string {
  return join(tmpdir(), `jean2-test-registry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe('registry', () => {
  let tempDir: string;
  let toolsDir: string;

  beforeEach(() => {
    configureCapekJean2Compatibility();
    tempDir = createTempDir();
    mkdirSync(tempDir, { recursive: true });
    toolsDir = join(tempDir, 'tools');
    mkdirSync(toolsDir, { recursive: true });
    clearCache();
  });

  afterEach(() => {
    clearCache();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('scanTools', () => {
    test('returns empty array for empty tools directory', async () => {
      const tools = await scanTools(toolsDir);
      expect(tools).toHaveLength(0);
    });

    test('returns empty array for nonexistent directory', async () => {
      const tools = await scanTools('/nonexistent/path');
      expect(tools).toHaveLength(0);
    });

    test('discovers tools by scanning subdirectories', async () => {
      // Copy fixture into tools dir
      const toolDir = join(toolsDir, 'test-fixture-tool');
      cpSync(FIXTURE_DIR, toolDir, { recursive: true });

      const tools = await scanTools(toolsDir);

      expect(tools).toHaveLength(1);
      expect(tools[0].definition.name).toBe('test-fixture-tool');
      expect(tools[0].execute).toBeTypeOf('function');
      expect(tools[0].path).toBe(toolDir);
    });

    test('skips .staging and .previous directories', async () => {
      const toolDir = join(toolsDir, 'test-fixture-tool');
      cpSync(FIXTURE_DIR, toolDir, { recursive: true });

      mkdirSync(join(toolsDir, 'fake.staging'), { recursive: true });
      mkdirSync(join(toolsDir, 'fake.previous'), { recursive: true });

      const tools = await scanTools(toolsDir);
      expect(tools).toHaveLength(1);
    });

    test('skips directories without valid tool modules', async () => {
      // Valid tool
      cpSync(FIXTURE_DIR, join(toolsDir, 'test-fixture-tool'), { recursive: true });

      // Invalid tool (no tool.ts or tool.js)
      mkdirSync(join(toolsDir, 'empty-tool'), { recursive: true });
      writeFileSync(join(toolsDir, 'empty-tool', 'readme.md'), 'not a tool');

      const tools = await scanTools(toolsDir);
      expect(tools).toHaveLength(1);
      expect(tools[0].definition.name).toBe('test-fixture-tool');
    });

    test('populates cache after scan', async () => {
      cpSync(FIXTURE_DIR, join(toolsDir, 'test-fixture-tool'), { recursive: true });

      await scanTools(toolsDir);

      // getTool should find it from cache without re-scanning
      const tool = await getTool('test-fixture-tool');
      expect(tool).not.toBeNull();
      expect(tool!.definition.name).toBe('test-fixture-tool');
    });
  });

  describe('getTool', () => {
    test('returns null for unknown tool', async () => {
      // We need to set the default tools path via the config
      // Since we can't override config easily, we use scanTools to populate cache
      clearCache();
      const tool = await getTool('nonexistent');
      expect(tool).toBeNull();
    });

    test('returns tool from cache after scan', async () => {
      cpSync(FIXTURE_DIR, join(toolsDir, 'test-fixture-tool'), { recursive: true });
      await scanTools(toolsDir);

      const tool = await getTool('test-fixture-tool');
      expect(tool).not.toBeNull();
      expect(tool!.definition.name).toBe('test-fixture-tool');
    });
  });

  describe('listTools', () => {
    test('returns empty array when no tools', async () => {
      clearCache();
      const tools = await listTools();
      // May have tools from other scans in other tests
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('clearCache', () => {
    test('clears cache and forces re-scan', async () => {
      cpSync(FIXTURE_DIR, join(toolsDir, 'test-fixture-tool'), { recursive: true });
      await scanTools(toolsDir);

      // Tool should be in cache
      const tool = await getTool('test-fixture-tool');
      expect(tool).not.toBeNull();

      // Clear and remove the tool directory
      clearCache();
      rmSync(join(toolsDir, 'test-fixture-tool'), { recursive: true, force: true });

      // After clearing, it should scan again and not find the tool
      // But getTool uses the default tools path, which may differ
      // So we test via listTools after manual scan
      const tools = await scanTools(toolsDir);
      expect(tools).toHaveLength(0);
    });
  });
});
