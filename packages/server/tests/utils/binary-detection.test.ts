import { describe, test, expect, afterEach } from 'bun:test';
import { isBinaryExtension, isBinaryFile } from '@/infrastructure/filesystem/binary-detection';

const tempFiles: string[] = [];

afterEach(() => {
  for (const path of tempFiles) {
    try {
      void Bun.file(path).size;
    } catch {
      // already gone
    }
  }
  tempFiles.length = 0;
});

function tempPath(name: string): string {
  const path = `/tmp/test-binary-${Date.now()}-${name}`;
  tempFiles.push(path);
  return path;
}

describe('isBinaryExtension', () => {
  test('recognizes common binary extensions', () => {
    const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.zip', '.exe', '.pdf', '.mp4', '.sqlite', '.db'];
    for (const ext of binaryExts) {
      expect(isBinaryExtension(ext)).toBe(true);
    }
  });

  test('rejects text extensions', () => {
    expect(isBinaryExtension('.ts')).toBe(false);
    expect(isBinaryExtension('.js')).toBe(false);
    expect(isBinaryExtension('.md')).toBe(false);
    expect(isBinaryExtension('.json')).toBe(false);
    expect(isBinaryExtension('.txt')).toBe(false);
  });

  test('handles case insensitivity', () => {
    expect(isBinaryExtension('.PNG')).toBe(true);
    expect(isBinaryExtension('.Jpg')).toBe(true);
    expect(isBinaryExtension('.PDF')).toBe(true);
  });

  test('handles undefined', () => {
    expect(isBinaryExtension(undefined)).toBe(false);
  });

  test('handles empty string', () => {
    expect(isBinaryExtension('')).toBe(false);
  });
});

describe('isBinaryFile', () => {
  test('detects text files as non-binary', async () => {
    const path = tempPath('text.txt');
    await Bun.write(path, 'hello world this is plain text');
    const result = await isBinaryFile(path, 28);
    expect(result).toBe(false);
  });

  test('detects binary extension as binary without reading content', async () => {
    const path = tempPath('image.png');
    await Bun.write(path, 'not actually png data');
    const result = await isBinaryFile(path, 20);
    expect(result).toBe(true);
  });

  test('detects files with null bytes as binary', async () => {
    const path = tempPath('binary.bin');
    const buffer = new Uint8Array([0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f]);
    await Bun.write(path, buffer);
    const result = await isBinaryFile(path, 6);
    expect(result).toBe(true);
  });

  test('returns false for empty files', async () => {
    const path = tempPath('empty.txt');
    await Bun.write(path, '');
    const result = await isBinaryFile(path, 0);
    expect(result).toBe(false);
  });

  test('detects files with high non-printable ratio as binary', async () => {
    const path = tempPath('high-binary.bin');
    const buffer = new Uint8Array(100);
    for (let i = 0; i < 100; i++) {
      buffer[i] = i < 50 ? 0x01 : 0x41; // 50% non-printable control chars
    }
    await Bun.write(path, buffer);
    const result = await isBinaryFile(path, 100);
    expect(result).toBe(true);
  });
});
