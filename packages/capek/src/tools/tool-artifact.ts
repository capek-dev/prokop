import { createReadStream, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import * as tar from 'tar';
import { BlobReader, ZipReader, BlobWriter } from '@zip.js/zip.js';
import { createHash } from 'crypto';

export class ArtifactError extends Error {
  constructor(message: string, public readonly stage: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export interface DownloadResult {
  archivePath: string;
}

export async function downloadArtifact(
  url: string,
  destDir: string,
): Promise<DownloadResult> {
  mkdirSync(destDir, { recursive: true });

  const urlPath = new URL(url).pathname;
  const archiveName = basename(urlPath) || 'artifact';
  const archivePath = join(destDir, archiveName);

  let response: Response;
  try {
    response = await fetch(url);
    if (!response.ok) {
      throw new ArtifactError(
        `HTTP ${response.status}: ${response.statusText}`,
        'download',
      );
    }
    const buffer = await response.arrayBuffer();
    await Bun.write(archivePath, buffer);
  } catch (err: unknown) {
    if (err instanceof ArtifactError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ArtifactError(`Download failed: ${message}`, 'download');
  }

  return { archivePath };
}

export async function verifyChecksum(
  archivePath: string,
  expectedSha256: string | undefined,
): Promise<void> {
  if (!expectedSha256) {
    return;
  }

  if (expectedSha256.trim() === '') {
    return;
  }

  const hash = createHash('sha256');
  const stream = createReadStream(archivePath);

  return new Promise((resolve, reject) => {
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actual = hash.digest('hex');
      if (actual !== expectedSha256) {
        reject(
          new ArtifactError(
            `Checksum mismatch: expected ${expectedSha256}, got ${actual}`,
            'checksum',
          ),
        );
      } else {
        resolve();
      }
    });
    stream.on('error', (err) =>
      reject(new ArtifactError(`Checksum read failed: ${err.message}`, 'checksum')),
    );
  });
}

export async function extractArtifact(
  archivePath: string,
  destDir: string,
): Promise<string> {
  const lower = archivePath.toLowerCase();

  try {
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      await extractTarGz(archivePath, destDir);
    } else if (lower.endsWith('.zip')) {
      await extractZip(archivePath, destDir);
    } else {
      throw new ArtifactError(
        `Unsupported archive format: ${archivePath}`,
        'extract',
      );
    }
  } catch (err: unknown) {
    if (err instanceof ArtifactError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ArtifactError(`Extraction failed: ${message}`, 'extract');
  }

  const extractedRoot = findExtractedRoot(destDir);
  return extractedRoot;
}

async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  await tar.x({
    file: tarPath,
    cwd: destDir,
    strip: 0,
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const file = Bun.file(zipPath);
  const blob = new Blob([await file.arrayBuffer()]);
  const reader = new ZipReader(new BlobReader(blob));

  const entries = await reader.getEntries();
  for (const entry of entries) {
    const entryPath = join(destDir, entry.filename);

    if (entry.directory) {
      mkdirSync(entryPath, { recursive: true });
      continue;
    }

    mkdirSync(dirname(entryPath), { recursive: true });
    const writer = new BlobWriter();
    await entry.getData(writer);
    const data = await writer.getData();
    await Bun.write(entryPath, data);
  }

  await reader.close();
}

function findExtractedRoot(destDir: string): string {
  const entries = readdirSync(destDir, { withFileTypes: true });
  const nonMetaEntries = entries.filter(
    (e) => !e.name.startsWith('.') && e.name !== 'archive' && !e.name.endsWith('.tar.gz') && !e.name.endsWith('.tgz') && !e.name.endsWith('.zip'),
  );

  if (nonMetaEntries.length === 1 && nonMetaEntries[0].isDirectory()) {
    return join(destDir, nonMetaEntries[0].name);
  }

  return destDir;
}

export interface ArtifactValidation {
  entrypoint: string;
  hasPackageJson: boolean;
  hasVersion: boolean;
}

export function validateArtifactStructure(
  extractedRoot: string,
  entry: string,
): ArtifactValidation {
  const entryPath = join(extractedRoot, entry);
  if (!existsSync(entryPath)) {
    throw new ArtifactError(
      `Entrypoint not found: ${entry}`,
      'validate',
    );
  }

  const hasPackageJson = existsSync(join(extractedRoot, 'package.json'));
  const hasVersion = existsSync(join(extractedRoot, 'VERSION'));

  return {
    entrypoint: entryPath,
    hasPackageJson,
    hasVersion,
  };
}
