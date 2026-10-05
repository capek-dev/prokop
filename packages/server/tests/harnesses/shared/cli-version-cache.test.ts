import { expect, test } from 'bun:test';
import { executableIdentity, memoizeCliProbe } from '@/harnesses/shared/cli-version-cache';

test('CLI probe runs once per executable identity', () => {
  let identity: string | null = 'bin-a';
  let calls = 0;
  const version = memoizeCliProbe('tool', () => `v${++calls}`, () => identity);

  expect(version()).toBe('v1');
  expect(version()).toBe('v1');
  expect(calls).toBe(1);

  // An upgraded or re-pathed binary is a new identity and probes again.
  identity = 'bin-b';
  expect(version()).toBe('v2');
  expect(version()).toBe('v2');
  expect(calls).toBe(2);
});

test('CLI probe caches a failure for the same binary and retries a changed one', () => {
  let identity = 'old';
  let calls = 0;
  const version = memoizeCliProbe('tool', () => {
    calls++;
    if (identity === 'old') throw new Error('too old');
    return 'v2';
  }, () => identity);

  expect(() => version()).toThrow('too old');
  expect(() => version()).toThrow('too old');
  expect(calls).toBe(1);

  identity = 'new';
  expect(version()).toBe('v2');
  expect(calls).toBe(2);
});

test('CLI probe is not cached while the command is missing from PATH', () => {
  let calls = 0;
  const version = memoizeCliProbe('tool', () => {
    calls++;
    throw new Error('missing');
  }, () => null);

  expect(() => version()).toThrow('missing');
  expect(() => version()).toThrow('missing');
  expect(calls).toBe(2);
});

test('executable identity resolves PATH commands and rejects missing ones', () => {
  expect(executableIdentity('sh')).toContain('\0');
  expect(executableIdentity(`missing-${crypto.randomUUID()}`)).toBeNull();
});
