import { describe, expect, test } from 'bun:test';
import { allocateContext, candidateId, memoryEntries, revisionOf, type ContextCandidate } from '@/application/context/selection';

const candidate = (id: string, kind: 'memory' | 'skill' = 'memory'): ContextCandidate => ({
  id, kind, source: 'agent', revision: 'revision', name: id, content: 'body', rendered: 'body',
});

describe('context allocation', () => {
  test('keeps multiline entries and fenced lists byte exact', () => {
    const first = '- guidance\n  details\n```md\n- example\n```';
    expect(memoryEntries(`${first}\n- next`)).toEqual([first, '- next']);
    expect(memoryEntries('prose\n- entry')).toEqual(['prose', '- entry']);
    expect(memoryEntries('  \n')).toEqual([]);
  });
  test('hashes include scope, revision and identity', () => {
    expect(revisionOf('a')).toBe(revisionOf('a'));
    expect(candidateId('a', 'b', 'c')).not.toBe(candidateId('b', 'a', 'c'));
    expect(candidateId('a', 'b', 'c')).not.toBe(candidateId('a', 'd', 'c'));
  });
  test('whole-item separate budgets, inclusive threshold and stable ties', () => {
    const result = allocateContext([candidate('a'), candidate('b'), candidate('c', 'skill'), candidate('d')], [2, 2, 3, 1], {
      threshold: 2, memoryChars: 6, skillChars: 6,
    });
    expect(result.selected.map(item => item.id)).toEqual(['c', 'a']);
    expect(result.items.map(item => item.content)).toEqual(['body', 'body']);
    expect(result.excluded.map(item => [item.id, item.reason])).toEqual([['b', 'budget'], ['d', 'threshold']]);
    expect(allocateContext([candidate('a')], [0]).selected).toEqual([]);
  });
  test('rejects malformed scores, policy and duplicate identities', () => {
    for (const score of [NaN, Infinity, -1, 4]) expect(() => allocateContext([candidate('a')], [score])).toThrow();
    expect(() => allocateContext([candidate('a')], [])).toThrow();
    expect(() => allocateContext([candidate('a'), candidate('a')], [2, 2])).toThrow();
    expect(() => allocateContext([], [], { threshold: 2, memoryChars: -1, skillChars: 0 })).toThrow();
  });
});
