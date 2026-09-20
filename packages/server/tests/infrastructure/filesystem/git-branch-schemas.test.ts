import { expect, test } from 'bun:test';
import { gitBranchActionSchema } from '../../../src/transport/http/routes/git-branch-schemas';

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
