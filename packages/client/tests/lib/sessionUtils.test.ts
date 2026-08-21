import { describe, test, expect } from 'vitest';
import { dedupeAndSortSessions } from '@/lib/sessionUtils';
import type { Session } from '@prokopai/sdk';

function makeSession(id: string, updatedAt: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    workspaceId: 'ws1',
    preconfigId: null,
    title: `Session ${id}`,
    status: 'active',
    createdAt: updatedAt,
    updatedAt,
    metadata: null,
    selectedModel: null,
    selectedProvider: null,
    selectedVariant: null,
    parentId: null,
    agentName: null,
    subagentStatus: null,
    runningAt: null,
    compacting: false,
    tags: [],
    autoApproveSeverity: null,
    agentId: null,
    ...overrides,
  } as Session;
}

describe('sessionUtils', () => {
  test('deduplicates by ID, keeping the last occurrence', () => {
    const result = dedupeAndSortSessions([
      makeSession('s1', '2025-01-01T00:00:00Z'),
      makeSession('s1', '2025-01-02T00:00:00Z', { title: 'Updated' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Updated');
  });

  test('sorts by updatedAt DESC, id DESC as tie-breaker', () => {
    const result = dedupeAndSortSessions([
      makeSession('s1', '2025-01-01T00:00:00Z'),
      makeSession('s2', '2025-01-03T00:00:00Z'),
      makeSession('s3', '2025-01-02T00:00:00Z'),
    ]);

    expect(result.map(s => s.id)).toEqual(['s2', 's3', 's1']);
  });

  test('uses id as tie-breaker when timestamps match', () => {
    const ts = '2025-01-01T00:00:00Z';
    const result = dedupeAndSortSessions([
      makeSession('a', ts),
      makeSession('b', ts),
      makeSession('c', ts),
    ]);

    expect(result.map(s => s.id)).toEqual(['c', 'b', 'a']);
  });

  test('handles empty input', () => {
    expect(dedupeAndSortSessions([])).toEqual([]);
  });
});
