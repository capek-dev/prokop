import { afterEach, expect, test } from 'bun:test';
import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateInstallationId } from '@/infrastructure/runtime/installation-id';

const roots: string[] = [];
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'prokop-install-id-'));
  roots.push(path);
  return path;
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

test('an existing data root keeps its ID across starts and does not mix with another root', () => {
  const first = root();
  const second = root();
  const id = getOrCreateInstallationId(first);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(getOrCreateInstallationId(first)).toBe(id);
  expect(getOrCreateInstallationId(second)).not.toBe(id);
  expect(readFileSync(join(first, 'installation-id'), 'utf8').trim()).toBe(id);
  expect(lstatSync(join(first, 'installation-id')).mode & 0o777).toBe(0o600);
});

test('invalid or linked identities fail closed instead of rotating', () => {
  const first = root();
  const other = root();
  writeFileSync(join(first, 'installation-id'), 'not a uuid');
  expect(() => getOrCreateInstallationId(first)).toThrow('Invalid installation identity');
  rmSync(join(first, 'installation-id'));
  const otherId = getOrCreateInstallationId(other);
  symlinkSync(join(other, 'installation-id'), join(first, 'installation-id'));
  expect(() => getOrCreateInstallationId(first)).toThrow('Invalid installation identity file');
  expect(getOrCreateInstallationId(other)).toBe(otherId);
});

test('missing data root is not created by probing identity', () => {
  const dir = root();
  const missing = join(dir, 'uninitialized');
  expect(() => getOrCreateInstallationId(missing)).toThrow();
});
