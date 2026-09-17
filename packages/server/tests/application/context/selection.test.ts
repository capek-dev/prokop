import { describe, expect, test } from 'bun:test';
import { allocateContext, candidateId, memoryEntries, revisionOf, type ContextCandidate } from '@/application/context/selection';

const candidate = (id: string, kind: 'memory' | 'skill' = 'memory'): ContextCandidate => ({
  id, kind, source: 'agent', revision: 'revision', name: id, content: 'body', rendered: 'body',
});

const judgment = (score: number) => ({ score, probabilities: [score === 0 ? 1 : 0, score === 1 ? 1 : 0, score === 2 ? 1 : 0, score === 3 ? 1 : 0] as const });

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
    const result = allocateContext([candidate('a'), candidate('b'), candidate('c', 'skill'), candidate('d')], [2, 2, 3, 1].map(judgment), {
      threshold: 2, requiredProbability: 0.7, memoryChars: 6, skillChars: 6,
    });
    expect(result.selected.map(item => item.id)).toEqual(['c', 'a']);
    expect(result.items.map(item => item.content)).toEqual(['body', 'body']);
    expect(result.excluded.map(item => [item.id, item.reason])).toEqual([['b', 'budget'], ['d', 'threshold']]);
    expect(allocateContext([candidate('a')], [judgment(0)]).selected).toEqual([]);
  });
  test('accepts 70 percent at level 2 even when expected score is below 2', () => {
    const result = allocateContext([candidate('a'), candidate('b'), candidate('c')], [
      { score: 1.7, probabilities: [0, 0.3, 0.7, 0] },
      { score: 2.1, probabilities: [0, 0.25, 0.4, 0.35] },
      { score: 1.6, probabilities: [0, 0.4, 0.6, 0] },
    ]);
    expect(result.items.map(item => [item.id, item.qualifyingProbability])).toEqual([['b', 0.75], ['a', 0.7]]);
    expect(result.excluded[0].id).toBe('c');
  });
  test('minimum level and required probability are configurable and inclusive', () => {
    const scores = [{ score: 2.1, probabilities: [0, 0.25, 0.4, 0.35] as const }];
    const policy = { threshold: 3, requiredProbability: 0.35, memoryChars: 100, skillChars: 100 };
    expect(allocateContext([candidate('a')], scores, policy).selected).toHaveLength(1);
    expect(allocateContext([candidate('a')], scores, { ...policy, requiredProbability: 0.36 }).selected).toHaveLength(0);
    expect(allocateContext([candidate('a')], scores, { ...policy, threshold: 0, requiredProbability: 1 }).selected).toHaveLength(1);
    expect(() => allocateContext([candidate('a')], [{ score: 2, probabilities: [0, 0, 0.7, 0.7] }])).toThrow();
    expect(() => allocateContext([], [], { ...policy, threshold: 1.5 })).toThrow();
    expect(() => allocateContext([], [], { ...policy, requiredProbability: NaN })).toThrow();
  });
  test('rejects malformed scores, policy and duplicate identities', () => {
    for (const score of [NaN, Infinity, -1, 4]) expect(() => allocateContext([candidate('a')], [judgment(score)])).toThrow();
    expect(() => allocateContext([candidate('a')], [])).toThrow();
    expect(() => allocateContext([candidate('a'), candidate('a')], [2, 2].map(judgment))).toThrow();
    expect(() => allocateContext([], [], { threshold: 2, requiredProbability: 0.7, memoryChars: -1, skillChars: 0 })).toThrow();
  });
});
