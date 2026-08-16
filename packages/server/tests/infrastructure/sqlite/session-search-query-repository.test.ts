import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  createSessionSearchQueryRepository,
  getMessageContentForFts,
  sanitizeFtsQuery,
} from '@/infrastructure/sqlite/session-search-query-repository';
import { createMessage, createPart, getDatabase } from '@/store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import {
  createTestTextPart,
  createTestToolPart,
  createTestUserMessage,
} from '#tests/factories';
import { seedSession, seedWorkspace } from '#tests/seed';

describe('SQLite session-search query repository', () => {
  let query: ReturnType<typeof createSessionSearchQueryRepository>;

  beforeEach(() => {
    setupTestDatabase();
    query = createSessionSearchQueryRepository(() => getDatabase());
  });

  afterEach(() => {
    resetTestDatabase();
  });

  function seedIndexedMessage(
    sessionId: string,
    messageId: string,
    text: string,
    createdAt: number,
  ): void {
    createMessage(createTestUserMessage(sessionId, { id: messageId, createdAt }));
    createPart(createTestTextPart(messageId, text), sessionId);
  }

  describe('search', () => {
    test('returns the exact result shape for a matching message', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'hello searchable world', 100);

      const results = query.searchMessages({
        query: 'searchable',
        workspaceId: 'ws-search',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'relevance',
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        messageId: 'm1',
        sessionId: session.id,
        workspaceId: 'ws-search',
        role: 'user',
        content: expect.stringContaining('searchable'),
        timestamp: 100,
        sessionTitle: session.title,
        rank: 1,
      });
      expect(results[0]!.content.length).toBeLessThanOrEqual(500);
    });

    test('orders results by newest, oldest, and relevance', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'alpha beta', 100);
      seedIndexedMessage(session.id, 'm2', 'alpha gamma', 200);
      seedIndexedMessage(session.id, 'm3', 'alpha delta', 300);

      const baseOptions = {
        query: 'alpha',
        roleFilter: ['user', 'assistant'],
        limit: 10,
      };

      expect(query.searchMessages({ ...baseOptions, sort: 'newest' }).map((r) => r.messageId))
        .toEqual(['m3', 'm2', 'm1']);
      expect(query.searchMessages({ ...baseOptions, sort: 'oldest' }).map((r) => r.messageId))
        .toEqual(['m1', 'm2', 'm3']);

      const relevance = query.searchMessages({ ...baseOptions, sort: 'relevance' });
      expect(relevance.map((r) => r.rank)).toEqual([1, 2, 3]);
    });

    test('pins raw row rank for newest and oldest sorts without normalizing', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'alpha beta', 100);
      seedIndexedMessage(session.id, 'm2', 'alpha gamma', 200);

      const rawRanks = getDatabase().query(
        'SELECT message_id, rank FROM messages_fts WHERE messages_fts MATCH ? ORDER BY rowid',
      ).all('alpha') as Array<{ message_id: string; rank: number }>;
      expect(rawRanks).toHaveLength(2);
      const rawByMessage = new Map(rawRanks.map((row) => [row.message_id, row.rank]));

      const newest = query.searchMessages({
        query: 'alpha',
        roleFilter: ['user'],
        limit: 10,
        sort: 'newest',
      });
      expect(newest.map((r) => r.messageId)).toEqual(['m2', 'm1']);
      for (const result of newest) {
        expect(result.rank).toBe(rawByMessage.get(result.messageId)!);
      }

      const oldest = query.searchMessages({
        query: 'alpha',
        roleFilter: ['user'],
        limit: 10,
        sort: 'oldest',
      });
      expect(oldest.map((r) => r.messageId)).toEqual(['m1', 'm2']);
      for (const result of oldest) {
        expect(result.rank).toBe(rawByMessage.get(result.messageId)!);
      }
    });

    test('respects workspace, session, role, and limit filters', () => {
      seedWorkspace({ id: 'ws-a' });
      seedWorkspace({ id: 'ws-b' });
      const sessionA = seedSession('ws-a');
      const sessionB = seedSession('ws-b');
      seedIndexedMessage(sessionA.id, 'ma1', 'needle one', 100);
      seedIndexedMessage(sessionA.id, 'ma2', 'needle two', 200);
      seedIndexedMessage(sessionB.id, 'mb1', 'needle three', 300);

      const all = query.searchMessages({
        query: 'needle',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'newest',
      });
      expect(all.map((r) => r.messageId)).toEqual(['mb1', 'ma2', 'ma1']);

      const workspaceFiltered = query.searchMessages({
        query: 'needle',
        workspaceId: 'ws-a',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'newest',
      });
      expect(workspaceFiltered.map((r) => r.messageId)).toEqual(['ma2', 'ma1']);

      const sessionFiltered = query.searchMessages({
        query: 'needle',
        sessionId: sessionA.id,
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'newest',
      });
      expect(sessionFiltered.map((r) => r.messageId)).toEqual(['ma2', 'ma1']);

      const roleFiltered = query.searchMessages({
        query: 'needle',
        roleFilter: ['assistant'],
        limit: 10,
        sort: 'newest',
      });
      expect(roleFiltered).toEqual([]);

      const limited = query.searchMessages({
        query: 'needle',
        roleFilter: ['user', 'assistant'],
        limit: 2,
        sort: 'newest',
      });
      expect(limited.map((r) => r.messageId)).toEqual(['mb1', 'ma2']);
    });

    test('falls back to a quoted plain query when the sanitized query fails', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'unclosed case', 100);

      // The unbalanced quote survives sanitization and makes the first MATCH
      // fail; the fallback strips it and searches the plain phrase.
      const results = query.searchMessages({
        query: '"unclosed',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'relevance',
      });

      expect(results.map((r) => r.messageId)).toEqual(['m1']);
    });

    test('returns empty for queries that sanitize to nothing', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'hello world', 100);

      expect(query.searchMessages({
        query: '***',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'relevance',
      })).toEqual([]);
      expect(query.searchMessages({
        query: '   ',
        roleFilter: ['user', 'assistant'],
        limit: 10,
        sort: 'relevance',
      })).toEqual([]);
    });

    test('returns empty for an empty role filter without touching the index', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'hello world', 100);

      // Pre-S5 this relied on the swallowed `IN ()` SQL error; the external
      // result is unchanged, but the early return is now explicit.
      expect(query.searchMessages({
        query: 'hello',
        roleFilter: [],
        limit: 10,
        sort: 'relevance',
      })).toEqual([]);
    });

    test('returns empty instead of surfacing errors when the fts table is missing', () => {
      const rawDb = new Database(':memory:');
      try {
        const repo = createSessionSearchQueryRepository(() => rawDb);
        expect(repo.searchMessages({
          query: 'anything',
          roleFilter: ['user'],
          limit: 10,
          sort: 'relevance',
        })).toEqual([]);
        expect(repo.searchMessages({
          query: '"unclosed',
          roleFilter: ['user'],
          limit: 10,
          sort: 'relevance',
        })).toEqual([]);
      } finally {
        rawDb.close();
      }
    });
  });

  describe('sanitization', () => {
    test('preserves the original sanitization behavior', () => {
      expect(sanitizeFtsQuery('')).toBe('');
      expect(sanitizeFtsQuery('   ')).toBe('');
      expect(sanitizeFtsQuery('plain words')).toBe('plain words');
      expect(sanitizeFtsQuery('"exact phrase" more')).toBe('"exact phrase" more');
      expect(sanitizeFtsQuery('hello AND world OR NOT query')).toBe('hello world query');
      expect(sanitizeFtsQuery('-leading trailing-')).toBe('leading trailing');
      expect(sanitizeFtsQuery('a*b {c} (d) [e] f:g~h')).toBe('a b c d e f g h');
      expect(sanitizeFtsQuery('"empty "" quotes"')).toBe('"empty" "quotes"');
    });
  });

  describe('counts', () => {
    test('counts total, before, and after with the original boundaries', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'one', 100);
      seedIndexedMessage(session.id, 'm2', 'two', 200);
      seedIndexedMessage(session.id, 'm3', 'three', 300);

      expect(query.countSessionMessages(session.id)).toBe(3);
      expect(query.countSessionMessages('missing')).toBe(0);
      expect(query.countMessagesBefore(session.id, 100)).toBe(0);
      expect(query.countMessagesBefore(session.id, 200)).toBe(1);
      expect(query.countMessagesBefore(session.id, 400)).toBe(3);
      expect(query.countMessagesAfter(session.id, 300)).toBe(0);
      expect(query.countMessagesAfter(session.id, 200)).toBe(1);
      expect(query.countMessagesAfter(session.id, 0)).toBe(3);
    });
  });

  describe('message lookups and surrounding lists', () => {
    test('returns latest and anchored messages in the original order and shape', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      seedIndexedMessage(session.id, 'm1', 'one', 100);
      seedIndexedMessage(session.id, 'm2', 'two', 200);
      seedIndexedMessage(session.id, 'm3', 'three', 300);

      expect(query.getLatestMessage(session.id)).toEqual({ id: 'm3', timestamp: 300 });
      expect(query.getLatestMessage('missing')).toBeNull();
      expect(query.getMessage('m2', session.id)).toEqual({ id: 'm2', timestamp: 200 });
      expect(query.getMessage('m2', 'other-session')).toBeNull();
      expect(query.getMessage('missing', session.id)).toBeNull();

      expect(query.listMessagesBefore(session.id, 300, 10)).toEqual([
        { id: 'm2', role: 'user', timestamp: 200 },
        { id: 'm1', role: 'user', timestamp: 100 },
      ]);
      expect(query.listMessagesBefore(session.id, 300, 1)).toEqual([
        { id: 'm2', role: 'user', timestamp: 200 },
      ]);
      expect(query.listMessagesAfter(session.id, 100, 10)).toEqual([
        { id: 'm2', role: 'user', timestamp: 200 },
        { id: 'm3', role: 'user', timestamp: 300 },
      ]);
      expect(query.listMessagesAfter(session.id, 100, 1)).toEqual([
        { id: 'm2', role: 'user', timestamp: 200 },
      ]);
    });
  });

  describe('summaries and content extraction', () => {
    test('summarizes role, timestamp, text content, and tool names', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));
      createPart(createTestTextPart('m1', 'hello world'), session.id);
      createPart(createTestToolPart('m1', { name: 'read-file' }), session.id);

      expect(query.getMessageSummary('m1')).toEqual({
        role: 'user',
        timestamp: 100,
        content: 'hello world',
        toolName: 'read-file',
      });
      expect(query.getMessageSummary('missing')).toBeNull();

      expect(getMessageContentForFts(getDatabase(), 'm1')).toEqual({
        content: 'hello world',
        toolName: 'read-file',
      });
    });

    test('extracts empty content for messages without indexable parts', () => {
      seedWorkspace({ id: 'ws-search' });
      const session = seedSession('ws-search');
      createMessage(createTestUserMessage(session.id, { id: 'm1', createdAt: 100 }));

      expect(getMessageContentForFts(getDatabase(), 'm1')).toEqual({ content: '', toolName: '' });
      expect(query.getMessageSummary('m1')).toEqual({
        role: 'user',
        timestamp: 100,
        content: '',
        toolName: '',
      });
    });
  });
});
