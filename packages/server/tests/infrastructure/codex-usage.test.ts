import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { parseCodexContextUsage, publishCodexContextUsage } from '@/harnesses/codex-cli/usage';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import type { ServerMessage } from '@prokopai/sdk';

const counts = { totalTokens: 1200, inputTokens: 800, cachedInputTokens: 200,
  cacheWriteInputTokens: 0, outputTokens: 400, reasoningOutputTokens: 100 };
const raw = { last: counts, total: { ...counts, totalTokens: 5000 }, modelContextWindow: 10000 };

beforeEach(() => { setupTestDatabase(); seedWorkspace({ id: 'ws', path: process.cwd() }); });
afterEach(() => resetTestDatabase());

test('Codex token usage requires complete nonnegative integer counts and a positive or null window', () => {
  expect(parseCodexContextUsage(raw)).toEqual(raw);
  expect(parseCodexContextUsage({ ...raw, modelContextWindow: null })).toEqual({ ...raw, modelContextWindow: null });
  for (const value of [undefined, 0, -1, 1.5, '100', NaN, Infinity]) {
    expect(parseCodexContextUsage({ ...raw, modelContextWindow: value })).toBeNull();
  }
  for (const value of [undefined, null, -1, 1.5, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(parseCodexContextUsage({ ...raw, last: { ...counts, inputTokens: value } })).toBeNull();
    expect(parseCodexContextUsage({ ...raw, total: { ...counts, totalTokens: value } })).toBeNull();
  }
  expect(parseCodexContextUsage({ ...raw, last: null })).toBeNull();
  expect(parseCodexContextUsage(null)).toBeNull();
});

test('Codex usage persists beside existing metadata and broadcasts the updated session', () => {
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: null, metadata: { other: 'kept' }, parentId: null, agentName: null, harness: 'codex-cli' });
  const messages: ServerMessage[] = [];
  const delivery = { broadcastToSession: (_id: string, message: ServerMessage) => { messages.push(message); } } as
    unknown as ApplicationDeliveryPort<unknown>;
  const usage = parseCodexContextUsage(raw)!;
  publishCodexContextUsage('s', usage, delivery);
  expect(getSession('s')?.metadata).toEqual({ other: 'kept', codexUsage: usage });
  expect(messages).toMatchObject([{ type: 'session.updated', session: { metadata: { codexUsage: usage } } }]);
  createSession({ id: 'prokop', workspaceId: 'ws', title: 'Other', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'prokop' });
  publishCodexContextUsage('prokop', usage, delivery);
  expect(getSession('prokop')?.metadata).toBeNull();
  expect(messages).toHaveLength(1);
});
