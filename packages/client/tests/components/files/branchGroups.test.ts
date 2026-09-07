import { describe, expect, test } from 'vitest';
import { branchLabelInGroup, groupBranchesByPrefix } from '@/components/files/branchGroups';

const named = (names: string[]) => names.map((name) => ({ name }));

describe('groupBranchesByPrefix', () => {
  test('root branches lead, prefixes become sorted groups', () => {
    const groups = groupBranchesByPrefix(named(['main', 'feature/1232', 'fix/crash', 'feature/login']));
    expect(groups).toEqual([
      { label: null, items: [{ name: 'main' }] },
      { label: 'feature', items: [{ name: 'feature/1232' }, { name: 'feature/login' }] },
      { label: 'fix', items: [{ name: 'fix/crash' }] },
    ]);
  });

  test('groups by the first segment only', () => {
    const groups = groupBranchesByPrefix(named(['feature/a/b']));
    expect(groups).toEqual([{ label: 'feature', items: [{ name: 'feature/a/b' }] }]);
    expect(branchLabelInGroup('feature/a/b', 'feature')).toBe('a/b');
  });

  test('empty prefix groups are dropped', () => {
    expect(groupBranchesByPrefix(named(['main']))).toEqual([{ label: null, items: [{ name: 'main' }] }]);
    expect(groupBranchesByPrefix([])).toEqual([]);
  });
});
