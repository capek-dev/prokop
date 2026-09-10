import { expect, test } from 'bun:test';
import { createKnowledgeStagingMutator } from '@/application/learning/knowledge-staging';

function fixture() {
  const initial = new Map([['MEMORY.md', 'Before']]);
  const staged = new Map(initial);
  const changes: unknown[] = [];
  let disposed = false;
  let authorized = true;
  const mutate = createKnowledgeStagingMutator({
    snapshot: async () => initial,
    create: async () => ({ directory: '/isolated', snapshot: async () => staged, dispose: async () => { disposed = true; } }),
    activate: async (...args) => { changes.push(args); },
  }, async () => { if (!authorized) throw new Error('Revoked'); });
  return { mutate, staged, changes, disposed: () => disposed, revoke: () => { authorized = false; } };
}

test('successful staged mutation activates exactly the changed file', async () => {
  const f = fixture();
  await f.mutate('memory', async directory => {
    expect(directory).toBe('/isolated');
    f.staged.set('MEMORY.md', 'After');
    return { success: true };
  });
  expect(f.changes).toEqual([['memory', 'MEMORY.md', 'Before', 'After']]);
  expect(f.disposed()).toBe(true);
});

test('failed and malformed executor results discard staged changes', async () => {
  for (const result of [{ success: false }, {}, null]) {
    const f = fixture();
    await f.mutate('memory', async () => { f.staged.set('MEMORY.md', 'Partial'); return result; });
    expect(f.changes).toEqual([]);
    expect(f.disposed()).toBe(true);
  }
});

test('multi-file mutations are rejected before any activation', async () => {
  const f = fixture();
  await expect(f.mutate('memory', async () => {
    f.staged.set('MEMORY.md', 'After');
    f.staged.set('USER.md', 'Unexpected');
    return { success: true };
  })).rejects.toThrow('multiple');
  expect(f.changes).toEqual([]);
  expect(f.disposed()).toBe(true);
});

test('revocation during execution prevents activation and still cleans up', async () => {
  const f = fixture();
  await expect(f.mutate('memory', async () => {
    f.staged.delete('MEMORY.md');
    f.revoke();
    return { success: true };
  })).rejects.toThrow('Revoked');
  expect(f.changes).toEqual([]);
  expect(f.disposed()).toBe(true);
});
