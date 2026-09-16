import { expect, test } from 'bun:test';
import { gitCommitSchema } from '../../../src/transport/http/routes/schemas';

const input = { paths: ['a'], message: 'Commit', expectedBranch: 'main', expectedHead: null };

test('commit hooks option accepts booleans and remains optional for older clients', () => {
  expect(gitCommitSchema.parse(input).runHooks).toBeUndefined();
  for (const runHooks of [true, false]) {
    expect(gitCommitSchema.parse({ ...input, runHooks }).runHooks).toBe(runHooks);
  }
});

test('commit hooks option rejects malformed values instead of coercing them', () => {
  for (const runHooks of ['false', 'true', 0, 1, null, {}, []]) {
    expect(gitCommitSchema.safeParse({ ...input, runHooks }).success).toBe(false);
  }
});
