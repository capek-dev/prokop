import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import * as tar from 'tar';
import { createHash } from 'crypto';

import { downloadArtifact, verifyChecksum, extractArtifact, validateArtifactStructure, ArtifactError } from '@capekai/core/tools';

const FIXTURE_DIR = resolve(import.meta.dir, 'fixtures', 'test-fixture-tool');

function createTempDir(): string {
  return join(tmpdir(), `jean2-test-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function createTarGz(sourceDir: string, outputPath: string): Promise<void> {
  await tar.c({
    gzip: true,
    file: outputPath,
    cwd: sourceDir,
  }, ['.']);
}

async function createTarGzWrapped(sourceDir: string, outputPath: string, wrapperName: string): Promise<void> {
  const tempStage = join(tmpdir(), `jean2-stage-${Date.now()}`);
  mkdirSync(join(tempStage, wrapperName), { recursive: true });

  const entries = readdirSync(sourceDir);
  for (const entry of entries) {
    const { cpSync } = await import('fs');
    cpSync(join(sourceDir, entry), join(tempStage, wrapperName, entry), { recursive: true });
  }

  await tar.c({
    gzip: true,
    file: outputPath,
    cwd: tempStage,
  }, ['.']);

  rmSync(tempStage, { recursive: true, force: true });
}

function _sha256File(filePath: string): string {
  const { readFileSync } = require('fs');
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

describe('tool-artifact', () => {
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

  describe('verifyChecksum', () => {
    test('passes when SHA-256 matches', async () => {
      const testFile = join(tempDir, 'test.bin');
      writeFileSync(testFile, 'hello world');

      const expected = createHash('sha256').update('hello world').digest('hex');
      await expect(verifyChecksum(testFile, expected)).resolves.toBeUndefined();
    });

    test('throws ArtifactError when checksum mismatches', async () => {
      const testFile = join(tempDir, 'test.bin');
      writeFileSync(testFile, 'hello world');

      try {
        await verifyChecksum(testFile, '0000000000000000000000000000000000000000');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactError);
        expect((err as ArtifactError).stage).toBe('checksum');
        expect((err as ArtifactError).message).toContain('Checksum mismatch');
      }
    });

    test('skips verification when expectedSha256 is undefined', async () => {
      const testFile = join(tempDir, 'test.bin');
      writeFileSync(testFile, 'anything');
      await expect(verifyChecksum(testFile, undefined)).resolves.toBeUndefined();
    });

    test('skips verification when expectedSha256 is empty string', async () => {
      const testFile = join(tempDir, 'test.bin');
      writeFileSync(testFile, 'anything');
      await expect(verifyChecksum(testFile, '')).resolves.toBeUndefined();
    });
  });

  describe('extractArtifact', () => {
    test('extracts .tar.gz archive', async () => {
      const archivePath = join(tempDir, 'tool.tar.gz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const extractDir = join(tempDir, 'extracted');
      mkdirSync(extractDir, { recursive: true });

      const result = await extractArtifact(archivePath, extractDir);

      expect(existsSync(join(result, 'tool.ts'))).toBe(true);
      expect(existsSync(join(result, 'package.json'))).toBe(true);
      expect(existsSync(join(result, 'VERSION'))).toBe(true);
    });

    test('extracts .tgz archive', async () => {
      const archivePath = join(tempDir, 'tool.tgz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const extractDir = join(tempDir, 'extracted');
      mkdirSync(extractDir, { recursive: true });

      const result = await extractArtifact(archivePath, extractDir);
      expect(existsSync(join(result, 'tool.ts'))).toBe(true);
    });

    test('unwraps single top-level directory', async () => {
      const archivePath = join(tempDir, 'wrapped.tar.gz');
      await createTarGzWrapped(FIXTURE_DIR, archivePath, 'tool-wrapper');

      const extractDir = join(tempDir, 'extracted');
      mkdirSync(extractDir, { recursive: true });

      const result = await extractArtifact(archivePath, extractDir);

      // Should unwrap the single 'tool-wrapper' directory
      expect(existsSync(join(result, 'tool.ts'))).toBe(true);
      expect(result.endsWith('tool-wrapper')).toBe(true);
    });

    test('throws ArtifactError for unsupported archive format', async () => {
      const fakeArchive = join(tempDir, 'tool.rar');
      writeFileSync(fakeArchive, 'not an archive');

      try {
        await extractArtifact(fakeArchive, tempDir);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactError);
        expect((err as ArtifactError).stage).toBe('extract');
        expect((err as ArtifactError).message).toContain('Unsupported archive format');
      }
    });
  });

  describe('validateArtifactStructure', () => {
    test('validates a correct artifact structure', () => {
      const validation = validateArtifactStructure(FIXTURE_DIR, 'tool.ts');
      expect(validation.hasPackageJson).toBe(true);
      expect(validation.hasVersion).toBe(true);
      expect(validation.entrypoint).toBe(join(FIXTURE_DIR, 'tool.ts'));
    });

    test('throws ArtifactError when entrypoint is missing', () => {
      try {
        validateArtifactStructure(tempDir, 'nonexistent.ts');
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactError);
        expect((err as ArtifactError).stage).toBe('validate');
        expect((err as ArtifactError).message).toContain('Entrypoint not found');
      }
    });

    test('reports missing package.json', () => {
      const noPkgDir = join(tempDir, 'no-pkg');
      mkdirSync(noPkgDir, { recursive: true });
      writeFileSync(join(noPkgDir, 'tool.ts'), 'export const definition = {}; export async function execute() {}');

      const validation = validateArtifactStructure(noPkgDir, 'tool.ts');
      expect(validation.hasPackageJson).toBe(false);
    });

    test('reports missing VERSION', () => {
      const noVersionDir = join(tempDir, 'no-version');
      mkdirSync(noVersionDir, { recursive: true });
      writeFileSync(join(noVersionDir, 'tool.ts'), 'export const definition = {};');
      writeFileSync(join(noVersionDir, 'package.json'), '{}');

      const validation = validateArtifactStructure(noVersionDir, 'tool.ts');
      expect(validation.hasVersion).toBe(false);
      expect(validation.hasPackageJson).toBe(true);
    });
  });

  describe('downloadArtifact', () => {
    test('downloads from a file:// URL', async () => {
      const archivePath = join(tempDir, 'download-test.tar.gz');
      await createTarGz(FIXTURE_DIR, archivePath);

      const destDir = join(tempDir, 'download-dest');
      mkdirSync(destDir, { recursive: true });

      const result = await downloadArtifact(`file://${archivePath}`, destDir);

      expect(result.archivePath).toBe(join(destDir, 'download-test.tar.gz'));
      expect(existsSync(result.archivePath)).toBe(true);
    });

    test('throws ArtifactError for non-existent file:// URL', async () => {
      const destDir = join(tempDir, 'download-dest');
      mkdirSync(destDir, { recursive: true });

      try {
        await downloadArtifact('file:///nonexistent/path/file.tar.gz', destDir);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ArtifactError);
        expect((err as ArtifactError).stage).toBe('download');
      }
    });
  });
});
