import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createAttentionFeed, type AttentionSnapshot } from '@/application/attention/feed';
import { createAttentionSource } from '@/infrastructure/sqlite/attention-source';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createPendingAsk, resolvePermissionRequestByRequestId } from '@/infrastructure/sqlite/pending-asks';
import { updateSession } from '@/infrastructure/sqlite/session-store';
import { createApp } from '@/transport/http/app';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { setupTestDataDir, resetTestDataDir } from '#tests/test-dir';
import { seedSession, seedWorkspace } from '#tests/seed';

function ask(sessionId: string, overrides: Partial<Parameters<typeof createPendingAsk>[0]> = {}) {
  return createPendingAsk({
    requestId: `req-${Math.random()}`,
    sessionId,
    workspaceId: 'ws1',
    toolCallId: `call-${Math.random()}`,
    toolName: 'bash',
    ask: { type: 'permission' } as never,
    status: 'pending',
    isPermission: true,
    createdAt: Date.now(),
    ...overrides,
  });
}

describe('attention feed', () => {
  beforeEach(() => {
    setupTestDataDir();
    setupTestDatabase();
    seedWorkspace({ id: 'ws1', name: 'website' });
  });

  afterEach(() => {
    resetTestDatabase();
    resetTestDataDir();
  });

  test('lists pending approvals and questions on their top-level session, and running sessions', () => {
    const root = seedSession('ws1', { id: 'root', title: 'Fix login' });
    seedSession('ws1', { id: 'child', title: 'Subagent', parentId: root.id });
    ask('child', { rootSessionId: 'root', toolName: 'bash' });
    ask('root', { isPermission: false, toolName: 'ask_user' });
    updateSession('root', { runningAt: new Date('2026-10-09T08:00:00Z').toISOString() });
    updateSession('child', { runningAt: new Date('2026-10-09T08:00:01Z').toISOString() });

    const snapshot = createAttentionFeed({ source: createAttentionSource(getDatabase) }).snapshot();
    expect(snapshot.asks.map((item) => [item.kind, item.sessionId, item.sessionTitle, item.workspaceName, item.toolName])).toEqual([
      ['approval', 'root', 'Fix login', 'website', 'bash'],
      ['question', 'root', 'Fix login', 'website', 'ask_user'],
    ]);
    expect(snapshot.running.map((item) => item.sessionId)).toEqual(['root']);
  });

  test('pushes a new snapshot only when the content changes', async () => {
    seedSession('ws1', { id: 's1', title: 'Deploy' });
    const feed = createAttentionFeed({ source: createAttentionSource(getDatabase), debounceMs: 5 });
    const pushed: AttentionSnapshot[] = [];
    const unsubscribe = feed.subscribe((snapshot) => pushed.push(snapshot));
    const initial = feed.snapshot();

    const requestId = 'req-1';
    ask('s1', { requestId });
    await Bun.sleep(30);
    expect(pushed.at(-1)?.asks.map((item) => item.sessionId)).toEqual(['s1']);
    expect(pushed.at(-1)!.revision).toBeGreaterThan(initial.revision);

    const count = pushed.length;
    updateSession('s1', { title: 'Deploy' });
    await Bun.sleep(30);
    expect(pushed.length).toBe(count);

    resolvePermissionRequestByRequestId(requestId, 'approved');
    updateSession('s1', { runningAt: new Date().toISOString() });
    await Bun.sleep(30);
    expect(pushed.at(-1)).toMatchObject({ asks: [], running: [{ sessionId: 's1' }] });

    unsubscribe();
    feed.dispose();
  });

  test('the events stream sends the snapshot at once and again on change', async () => {
    seedSession('ws1', { id: 's1', title: 'Deploy' });
    const app = createApp();
    const res = await app.request('/api/attention/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();

    const nextSnapshot = async (): Promise<AttentionSnapshot> => {
      let buffer = '';
      for (;;) {
        const { value } = await reader.read();
        buffer += value;
        const frame = buffer.split('\n\n').find((part) => part.includes('event: snapshot'));
        if (frame) return JSON.parse(frame.split('\n').find((line) => line.startsWith('data:'))!.slice(5));
      }
    };

    expect(await nextSnapshot()).toMatchObject({ asks: [], running: [] });
    ask('s1');
    expect((await nextSnapshot()).asks.map((item) => item.sessionId)).toEqual(['s1']);
    await reader.cancel();
  });

  test('other devices need pairing to read it', async () => {
    const app = createApp();
    expect((await app.request('/api/attention')).status).toBe(200);
    expect((await app.request('http://prokop.example.com/api/attention')).status).toBe(401);
  });
});
