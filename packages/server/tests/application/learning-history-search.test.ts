import { expect, test } from 'bun:test';
import { createLearningHistorySearch } from '@/application/learning/history-search';

function fixture() {
  const excluded = new Set(['secret']);
  const reads: string[] = [];
  const search = createLearningHistorySearch({
    authorize: async () => {},
    candidates: async () => [
      { messageId: 'secret', sessionId: 'private', completedAt: 300 },
      { messageId: 'answer', sessionId: 'public', completedAt: 200 },
    ],
    eligible: id => !excluded.has(id),
    readTurn: id => { reads.push(id); return [{ id, role: 'assistant', content: 'Verified migration procedure' }]; },
  });
  return { search, excluded, reads };
}

test('excluded sessions never appear in list, direct reads or search snippets', async () => {
  const f = fixture();
  expect((await f.search({ action: 'list', limit: 1 })).result).toEqual({ sessions: [{ sessionId: 'public', latestCompletedAt: 200, turnCount: 1 }], bounded: true });
  expect((await f.search({ action: 'read', sessionId: 'private' })).result).toEqual({ turns: [], bounded: true });
  const searched = await f.search({ action: 'search', query: 'migration', limit: 1 });
  expect(JSON.stringify(searched)).toContain('answer');
  expect(JSON.stringify(searched)).not.toContain('secret');
  expect(f.reads).toEqual(['answer']);
});

test('changed eligibility is honored without recreating the search tool', async () => {
  const f = fixture();
  f.excluded.add('answer');
  expect((await f.search({ action: 'search', query: 'migration' })).result).toEqual({ turns: [], bounded: true });
  expect(f.reads).toEqual([]);
});

test('malformed requests fail without accessing history', async () => {
  const f = fixture();
  for (const input of [{ action: 'delete' }, { action: 'read' }, { query: '' }, { query: 42, action: 'search' }, { limit: -1 }]) {
    expect((await f.search(input)).success).toBe(false);
  }
  expect(f.reads).toEqual([]);
});
