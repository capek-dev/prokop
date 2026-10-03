import { afterEach, expect, test } from 'bun:test';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureSessionTempDir, sessionTempEnvironment } from '@/infrastructure/filesystem/session-temp';

const fixtures: string[] = [];
function fixture(): string {
  const path = mkdtempSync(join(tmpdir(), 'session-temp-test-'));
  fixtures.push(path);
  return path;
}
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }); });

test('creates isolated private directories and reuses them without touching contents', async () => {
  const base = fixture();
  const paths = await Promise.all([1, 2, 3].map(async () => ensureSessionTempDir('session-a', base)));
  expect(new Set(paths).size).toBe(1);
  const path = paths[0]!;
  writeFileSync(join(path, 'keep'), 'keep');
  expect(ensureSessionTempDir('session-a', base)).toBe(path);
  expect(ensureSessionTempDir('session-b', base)).not.toBe(path);
  if (process.platform !== 'win32') expect(lstatSync(path).mode & 0o777).toBe(0o700);
  expect(sessionTempEnvironment(path)).toEqual({ TMPDIR: path, TEMP: path, TMP: path });
});

test('rejects malformed session identities', () => {
  const base = fixture();
  for (const id of ['', '..', '../other', '/absolute', 'a/b', 'a\\b', 'a\0b', 'a'.repeat(129)]) {
    expect(() => ensureSessionTempDir(id, base)).toThrow();
  }
});

test('canonicalizes the OS temp base but rejects symlinked owned directories', () => {
  const base = fixture();
  const alias = join(base, 'alias');
  const real = join(base, 'real');
  mkdirSync(real);
  symlinkSync(real, alias);
  expect(ensureSessionTempDir('a', alias)).toBe(join(realpathSync(real), 'jean2/a'));
  symlinkSync(real, join(base, 'jean2'));
  expect(() => ensureSessionTempDir('a', base)).toThrow('Unsafe');
  symlinkSync(base, join(real, 'jean2/b'));
  expect(() => ensureSessionTempDir('b', real)).toThrow('Unsafe');
});

test('rejects collisions and writable shared directories without repairing them', () => {
  const base = fixture();
  writeFileSync(join(base, 'jean2'), 'user file');
  expect(() => ensureSessionTempDir('a', base)).toThrow('Unsafe');
  const other = fixture();
  const path = ensureSessionTempDir('a', other);
  if (process.platform !== 'win32') {
    chmodSync(path, 0o777);
    expect(() => ensureSessionTempDir('a', other)).toThrow('Unsafe');
    expect(lstatSync(path).mode & 0o777).toBe(0o777);
  }
});
