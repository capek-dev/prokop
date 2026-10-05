import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { TextPart } from '@prokopai/sdk';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspaceWithSession } from '#tests/seed';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createMessage, createPart, getPart } from '@/infrastructure/sqlite/message-store';
import { StreamingTextWriter } from '@/harnesses/shared/streaming-text';

let sessionId: string;
let part: TextPart;

beforeEach(() => {
  setupTestDatabase();
  sessionId = seedWorkspaceWithSession().sessionId;
  const message = createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'streaming',
    modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() });
  part = createPart({ id: crypto.randomUUID(), messageId: message.id, type: 'text', text: '',
    createdAt: Date.now() }, sessionId) as TextPart;
});

afterEach(() => resetTestDatabase());

function storedText(): string {
  return (getPart(part.id) as TextPart).text;
}

function indexedContent(): string | null {
  const row = getDatabase().query('SELECT content FROM messages_fts WHERE message_id = ?')
    .get(part.messageId) as { content: string } | null;
  return row?.content ?? null;
}

test('streamed text persists a snapshot at most once per interval', () => {
  let now = 1_000;
  const writer = new StreamingTextWriter({ intervalMs: 300, now: () => now });

  writer.append(sessionId, part, 'a');
  expect(storedText()).toBe('a');

  now += 100;
  writer.append(sessionId, part, 'ab');
  writer.append(sessionId, part, 'abc');
  expect(storedText()).toBe('a');

  now += 200;
  writer.append(sessionId, part, 'abcd');
  expect(storedText()).toBe('abcd');
});

test('snapshots skip the search index and settle indexes the final text once', () => {
  let now = 1_000;
  const writer = new StreamingTextWriter({ intervalMs: 300, now: () => now });

  writer.append(sessionId, part, 'hello');
  now += 50;
  writer.append(sessionId, part, 'hello world');
  expect(indexedContent()).toBeNull();

  const settled = writer.settle(part.id) as TextPart;
  expect(settled.text).toBe('hello world');
  expect(storedText()).toBe('hello world');
  expect(indexedContent()).toBe('hello world');

  // Settling ends throttling: a second settle has nothing to write.
  expect(writer.settle(part.id)).toBeNull();
});

test('settle writes an authoritative final text over the streamed one', () => {
  const writer = new StreamingTextWriter({ now: () => 1_000 });
  writer.append(sessionId, part, 'draft');

  expect((writer.settle(part.id, 'final') as TextPart).text).toBe('final');
  expect(storedText()).toBe('final');
});

test('settleAll flushes every open part with its session', () => {
  let now = 1_000;
  const writer = new StreamingTextWriter({ intervalMs: 300, now: () => now });
  writer.append(sessionId, part, 'a');
  now += 10;
  writer.append(sessionId, part, 'ab');

  const settled = writer.settleAll();
  expect(settled.map(entry => [entry.sessionId, (entry.part as TextPart).text])).toEqual([[sessionId, 'ab']]);
  expect(storedText()).toBe('ab');
  expect(writer.settleAll()).toEqual([]);
});
