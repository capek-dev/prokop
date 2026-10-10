import { expect, test } from 'bun:test';
import { gitBranchActionSchema } from '@/transport/http/routes/git-branch-schemas';

const input = { action: 'pull-branch', name: 'main', expectedHead: 'a'.repeat(40), root: '/tree' } as const;

test('non-checkout pull accepts only a named target and reviewed head', () => {
  expect(gitBranchActionSchema.parse(input)).toEqual(input);
});

test.each([
  { ...input, expectedHead: 'HEAD' },
  { ...input, name: '-main' },
  { ...input, name: 'main\0other' },
  { ...input, expectedHead: undefined },
  { ...input, force: true },
  { ...input, remote: 'origin' },
])('non-checkout pull rejects malformed or additional fields: %j', (value) => {
  expect(gitBranchActionSchema.safeParse(value).success).toBe(false);
});

test('set-upstream names a local branch and a remote branch, nothing else', () => {
  const upstream = { action: 'set-upstream', name: 'feature', remote: 'origin', branch: 'feature' } as const;
  expect(gitBranchActionSchema.parse(upstream)).toEqual(upstream);
  expect(gitBranchActionSchema.safeParse({ ...upstream, remote: '--all' }).success).toBe(false);
  expect(gitBranchActionSchema.safeParse({ ...upstream, force: true }).success).toBe(false);
});

test('push accepts an optional runHooks flag', () => {
  const push = { action: 'push', sourceBranch: 'main', expectedHead: 'a'.repeat(40), remote: 'origin', branch: 'main', expectedRemoteHead: null, force: false } as const;
  expect(gitBranchActionSchema.parse({ ...push, runHooks: false })).toEqual({ ...push, runHooks: false });
  expect(gitBranchActionSchema.safeParse({ ...push, runHooks: 'no' }).success).toBe(false);
});
