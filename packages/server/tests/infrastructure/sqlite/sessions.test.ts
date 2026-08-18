import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestSession } from '#tests/factories';
import { seedWorkspace } from '#tests/seed';
import {
  createSession,
  getSession,
  getSessionWithWorkspace,
  updateSession,
  deleteSession,
  listSessions,
  listSessionsByWorkspace,
  listSessionsGrouped,
  getChildSessions,
  deleteSessionsByWorkspace,
  listSessionPageByWorkspace,
  listSessionPageGrouped,
  encodeSessionCursor,
  decodeSessionCursor,
} from '@/infrastructure/sqlite/session-store';
import { getDatabase } from '@/infrastructure/sqlite/database';

function makeSession(overrides: {
  id: string;
  workspaceId: string;
  title: string;
  status: 'active' | 'closed';
  parentId?: string;
  selectedModel?: string | null;
  selectedProvider?: string | null;
  selectedVariant?: string | null;
  preconfigId?: string | null;
  metadata?: Record<string, unknown> | null;
  updatedAt?: string;
}) {
  const { createdAt: _c, updatedAt: _u, ...defaults } = createTestSession(overrides);
  return defaults;
}

describe('sessions store', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  describe('createSession', () => {
    test('creates and returns a session', () => {
      seedWorkspace({ id: 'ws1' });
      const session = createSession(makeSession({
        id: 's1',
        workspaceId: 'ws1',
        title: 'Test',
        status: 'active',
      }));

      expect(session.id).toBe('s1');
      expect(session.workspaceId).toBe('ws1');
      expect(session.title).toBe('Test');
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    test('stores optional fields', () => {
      seedWorkspace({ id: 'ws1' });
      const session = createSession(makeSession({
        id: 's2',
        workspaceId: 'ws1',
        title: 'With Options',
        status: 'active',
        selectedModel: 'gpt-4o',
        selectedProvider: 'openai',
        selectedVariant: 'default',
        preconfigId: 'preconfig-1',
        metadata: { key: 'value' },
      }));

      expect(session.selectedModel).toBe('gpt-4o');
      expect(session.selectedProvider).toBe('openai');
      expect(session.selectedVariant).toBe('default');
      expect(session.preconfigId).toBe('preconfig-1');
      expect(session.metadata).toEqual({ key: 'value' });
    });

    test('creates session with parentId for subagents', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({
        id: 'parent',
        workspaceId: 'ws1',
        title: 'Parent',
        status: 'active',
      }));

      const child = createSession(makeSession({
        id: 'child',
        workspaceId: 'ws1',
        title: 'Child',
        status: 'active',
        parentId: 'parent',
      }));

      expect(child.parentId).toBe('parent');
    });
  });

  describe('getSession', () => {
    test('returns session by id', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      const session = getSession('s1');
      expect(session).not.toBeNull();
      expect(session!.id).toBe('s1');
    });

    test('returns null for non-existent session', () => {
      expect(getSession('nonexistent')).toBeNull();
    });
  });

  describe('getSessionWithWorkspace', () => {
    test('returns session with workspace', () => {
      seedWorkspace({ id: 'ws1', name: 'My Workspace', path: '/test' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      const result = getSessionWithWorkspace('s1');
      expect(result).not.toBeNull();
      expect(result!.session.id).toBe('s1');
      expect(result!.workspace).not.toBeNull();
      expect(result!.workspace!.name).toBe('My Workspace');
    });

    test('returns null for non-existent session', () => {
      expect(getSessionWithWorkspace('nonexistent')).toBeNull();
    });
  });

  describe('updateSession', () => {
    test('updates title', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Original', status: 'active' }));

      const updated = updateSession('s1', { title: 'Updated' });
      expect(updated!.title).toBe('Updated');
    });

    test('updates status', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      const updated = updateSession('s1', { status: 'closed' });
      expect(updated!.status).toBe('closed');
    });

    test('updates multiple fields at once', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      const updated = updateSession('s1', {
        title: 'New Title',
        status: 'closed',
        selectedModel: 'claude-3',
        selectedProvider: 'anthropic',
      });

      expect(updated!.title).toBe('New Title');
      expect(updated!.status).toBe('closed');
      expect(updated!.selectedModel).toBe('claude-3');
      expect(updated!.selectedProvider).toBe('anthropic');
    });

    test('updates compacting flag', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      const updated = updateSession('s1', { compacting: true });
      expect(updated!.compacting).toBe(true);
    });

    test('returns null for non-existent session', () => {
      expect(updateSession('nonexistent', { title: 'x' })).toBeNull();
    });

    test('always updates updatedAt', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active', updatedAt: '2020-01-01T00:00:00.000Z' }));

      const updated = updateSession('s1', { title: 'New' });
      expect(updated!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    });
  });

  describe('deleteSession', () => {
    test('deletes a session and returns true', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'Test', status: 'active' }));

      expect(deleteSession('s1')).toBe(true);
      expect(getSession('s1')).toBeNull();
    });

    test('returns false for non-existent session', () => {
      expect(deleteSession('nonexistent')).toBe(false);
    });
  });

  describe('listSessions', () => {
    test('returns all sessions', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'closed' }));

      const sessions = listSessions();
      expect(sessions).toHaveLength(2);
    });

    test('filters by status', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'closed' }));

      const active = listSessions('active');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('s1');
    });
  });

  describe('listSessionsByWorkspace', () => {
    test('returns sessions for a workspace', () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'active' }));
      createSession(makeSession({ id: 's3', workspaceId: 'ws2', title: 'C', status: 'active' }));

      const sessions = listSessionsByWorkspace('ws1');
      expect(sessions).toHaveLength(2);
    });

    test('filters by status', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'closed' }));

      const active = listSessionsByWorkspace('ws1', { status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('s1');
    });

    test('filters rootOnly', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 'parent', workspaceId: 'ws1', title: 'P', status: 'active' }));
      createSession(makeSession({ id: 'child', workspaceId: 'ws1', title: 'C', status: 'active', parentId: 'parent' }));

      const roots = listSessionsByWorkspace('ws1', { rootOnly: true });
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe('parent');
    });

    test('returns empty for workspace with no sessions', () => {
      seedWorkspace({ id: 'ws1' });
      expect(listSessionsByWorkspace('ws1')).toHaveLength(0);
    });
  });

  describe('listSessionsGrouped', () => {
    test('groups sessions by workspace', () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws2', title: 'B', status: 'active' }));
      createSession(makeSession({ id: 's3', workspaceId: 'ws2', title: 'C', status: 'active' }));

      const grouped = listSessionsGrouped(['ws1', 'ws2']);
      expect(grouped['ws1']).toHaveLength(1);
      expect(grouped['ws2']).toHaveLength(2);
    });

    test('includes empty arrays for workspace IDs with no sessions', () => {
      seedWorkspace({ id: 'ws1' });
      const grouped = listSessionsGrouped(['ws1']);
      expect(grouped['ws1']).toHaveLength(0);
    });

    test('filters by status', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'closed' }));

      const grouped = listSessionsGrouped(['ws1'], { status: 'active' });
      expect(grouped['ws1']).toHaveLength(1);
    });
  });

  describe('getChildSessions', () => {
    test('returns child sessions', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 'parent', workspaceId: 'ws1', title: 'P', status: 'active' }));
      createSession(makeSession({ id: 'child1', workspaceId: 'ws1', title: 'C1', status: 'active', parentId: 'parent' }));
      createSession(makeSession({ id: 'child2', workspaceId: 'ws1', title: 'C2', status: 'active', parentId: 'parent' }));

      const children = getChildSessions('parent');
      expect(children).toHaveLength(2);
    });

    test('returns empty for session with no children', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 'solo', workspaceId: 'ws1', title: 'Solo', status: 'active' }));

      expect(getChildSessions('solo')).toHaveLength(0);
    });
  });

  describe('deleteSessionsByWorkspace', () => {
    test('deletes all sessions in a workspace', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'A', status: 'active' }));
      createSession(makeSession({ id: 's2', workspaceId: 'ws1', title: 'B', status: 'active' }));

      deleteSessionsByWorkspace('ws1');
      expect(getSession('s1')).toBeNull();
      expect(getSession('s2')).toBeNull();
    });
  });

  // ===========================================================================
  // Phase 5: Cursor Pagination
  // ===========================================================================

  describe('cursor pagination (Phase 5)', () => {
    test('encodeSessionCursor and decodeSessionCursor roundtrip', () => {
      const payload = { version: 1 as const, updatedAt: '2025-01-15T10:00:00.000Z', id: 'sess-123' };
      const encoded = encodeSessionCursor(payload);
      const decoded = decodeSessionCursor(encoded);
      expect(decoded).toEqual(payload);
    });

    test('decodeSessionCursor returns null for invalid input', () => {
      expect(decodeSessionCursor('not-valid-base64')).toBeNull();
      expect(decodeSessionCursor('')).toBeNull();
      // Valid base64 but invalid JSON
      expect(decodeSessionCursor(Buffer.from('{bad}').toString('base64url'))).toBeNull();
      // Valid JSON but wrong version
      const badVersion = Buffer.from(JSON.stringify({ version: 2, updatedAt: '2025-01-15T10:00:00.000Z', id: 'x' })).toString('base64url');
      expect(decodeSessionCursor(badVersion)).toBeNull();
      // Missing id
      const noId = Buffer.from(JSON.stringify({ version: 1, updatedAt: '2025-01-15T10:00:00.000Z' })).toString('base64url');
      expect(decodeSessionCursor(noId)).toBeNull();
      // Invalid timestamp
      const badTs = Buffer.from(JSON.stringify({ version: 1, updatedAt: 'not-a-date', id: 'x' })).toString('base64url');
      expect(decodeSessionCursor(badTs)).toBeNull();
    });

    test('first page returns at most limit rows', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 5; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const page = listSessionPageByWorkspace('ws1', { limit: 3 });
      expect(page.sessions).toHaveLength(3);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).not.toBeNull();
    });

    test('limit + 1 detects hasMore without returning extra row', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 4; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const page = listSessionPageByWorkspace('ws1', { limit: 3 });
      expect(page.sessions).toHaveLength(3);
      expect(page.hasMore).toBe(true);
    });

    test('final page has null cursor and hasMore false', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 3; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const page = listSessionPageByWorkspace('ws1', { limit: 10 });
      expect(page.sessions).toHaveLength(3);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    test('next page is disjoint from the first', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 6; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const page1 = listSessionPageByWorkspace('ws1', { limit: 3 });
      expect(page1.nextCursor).not.toBeNull();

      const page2 = listSessionPageByWorkspace('ws1', { limit: 3, cursor: page1.nextCursor! });

      const page1Ids = new Set(page1.sessions.map((s) => s.id));
      const page2Ids = new Set(page2.sessions.map((s) => s.id));
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    test('status and root-only filters remain active on every page', () => {
      seedWorkspace({ id: 'ws1' });
      // 3 active root, 2 closed root, 1 active child of a1
      createSession(makeSession({ id: 'a1', workspaceId: 'ws1', title: 'A1', status: 'active' }));
      createSession(makeSession({ id: 'a2', workspaceId: 'ws1', title: 'A2', status: 'active' }));
      createSession(makeSession({ id: 'a3', workspaceId: 'ws1', title: 'A3', status: 'active' }));
      createSession(makeSession({ id: 'c1', workspaceId: 'ws1', title: 'C1', status: 'closed' }));
      createSession(makeSession({ id: 'c2', workspaceId: 'ws1', title: 'C2', status: 'closed' }));
      createSession(makeSession({ id: 'child', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: 'a1' }));

      const page = listSessionPageByWorkspace('ws1', { status: 'active', rootOnly: true, limit: 50 });
      // 3 active roots + 1 child of an active root
      expect(page.sessions).toHaveLength(4);
      // Closed sessions excluded
      expect(page.sessions.every((s) => s.status === 'active')).toBe(true);
      // Root sessions have parentId null, child does not
      const roots = page.sessions.filter((s) => s.parentId === null);
      const children = page.sessions.filter((s) => s.parentId !== null);
      expect(roots).toHaveLength(3);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe('child');
      // hasMore is false (all roots fit in one page)
      expect(page.hasMore).toBe(false);
    });

    test('deleted cursor row does not break traversal', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 5; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const page1 = listSessionPageByWorkspace('ws1', { limit: 2 });
      expect(page1.nextCursor).not.toBeNull();

      // Delete the session that the cursor points to
      const cursorId = page1.nextCursor!.id;
      deleteSession(cursorId);

      // Next page should still work (cursor values are self-contained)
      const page2 = listSessionPageByWorkspace('ws1', { limit: 2, cursor: page1.nextCursor! });
      expect(page2.sessions.length).toBeGreaterThan(0);
      // The deleted session should not appear
      expect(page2.sessions.find((s) => s.id === cursorId)).toBeUndefined();
    });

    test('limit is clamped to max 100', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'S1', status: 'active' }));

      const page = listSessionPageByWorkspace('ws1', { limit: 500 });
      expect(page.sessions).toHaveLength(1);
    });

    test('query plan uses workspace-leading index', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'S1', status: 'active' }));

      const db = getDatabase();
      const plan = db.query(
        `EXPLAIN QUERY PLAN
         SELECT * FROM sessions
         WHERE workspace_id = ? AND status = ?
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      ).all('ws1', 'active', 10) as { detail: string }[];

      const planText = plan.map((p) => p.detail).join(' ');
      expect(planText).toContain('idx_sessions');
    });
  });

  // ===========================================================================
  // Phase 5: Grouped Pagination
  // ===========================================================================

  describe('grouped pagination (Phase 5)', () => {
    test('grouped initial page enforces limit independently per workspace', () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });

      for (let i = 0; i < 5; i++) {
        createSession(makeSession({ id: `ws1-s${i}`, workspaceId: 'ws1', title: `WS1-${i}`, status: 'active' }));
      }
      for (let i = 0; i < 3; i++) {
        createSession(makeSession({ id: `ws2-s${i}`, workspaceId: 'ws2', title: `WS2-${i}`, status: 'active' }));
      }

      const result = listSessionPageGrouped(['ws1', 'ws2'], { limitPerWorkspace: 2 });
      expect(result.sessions['ws1']).toHaveLength(2);
      expect(result.sessions['ws2']).toHaveLength(2);
      expect(result.pagination['ws1'].hasMore).toBe(true);
      expect(result.pagination['ws2'].hasMore).toBe(true);
      expect(result.pagination['ws1'].nextCursor).not.toBeNull();
      expect(result.pagination['ws2'].nextCursor).not.toBeNull();
    });

    test('empty workspaces have empty arrays and hasMore false', () => {
      seedWorkspace({ id: 'ws1' });
      seedWorkspace({ id: 'ws2' });
      createSession(makeSession({ id: 's1', workspaceId: 'ws1', title: 'S1', status: 'active' }));

      const result = listSessionPageGrouped(['ws1', 'ws2'], { limitPerWorkspace: 10 });
      expect(result.sessions['ws1']).toHaveLength(1);
      expect(result.sessions['ws2']).toHaveLength(0);
      expect(result.pagination['ws2'].hasMore).toBe(false);
      expect(result.pagination['ws2'].nextCursor).toBeNull();
    });

    test('grouped with root-only and status filters', () => {
      seedWorkspace({ id: 'ws1' });
      createSession(makeSession({ id: 'a1', workspaceId: 'ws1', title: 'A1', status: 'active' }));
      createSession(makeSession({ id: 'c1', workspaceId: 'ws1', title: 'C1', status: 'closed' }));
      createSession(makeSession({ id: 'child', workspaceId: 'ws1', title: 'Child', status: 'active', parentId: 'a1' }));

      const result = listSessionPageGrouped(['ws1'], { status: 'active', rootOnly: true, limitPerWorkspace: 10 });
      // 1 active root + 1 child of the active root
      expect(result.sessions['ws1']).toHaveLength(2);
      const roots = result.sessions['ws1'].filter((s) => s.parentId === null);
      const children = result.sessions['ws1'].filter((s) => s.parentId !== null);
      expect(roots).toHaveLength(1);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe('child');
      expect(result.sessions['ws1'][0].id).toBe('a1');
    });

    test('grouped pagination returns cursor metadata per workspace', () => {
      seedWorkspace({ id: 'ws1' });
      for (let i = 0; i < 5; i++) {
        createSession(makeSession({ id: `s${i}`, workspaceId: 'ws1', title: `S${i}`, status: 'active' }));
      }

      const result = listSessionPageGrouped(['ws1'], { limitPerWorkspace: 3 });
      const ws1Pagination = result.pagination['ws1'];
      expect(ws1Pagination.hasMore).toBe(true);
      expect(ws1Pagination.nextCursor).not.toBeNull();
      expect(ws1Pagination.limit).toBe(3);

      // The cursor should be decodable
      const decoded = decodeSessionCursor(ws1Pagination.nextCursor!);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBeDefined();
    });

    test('empty workspaceIds returns empty result', () => {
      const result = listSessionPageGrouped([], { limitPerWorkspace: 10 });
      expect(Object.keys(result.sessions)).toHaveLength(0);
      expect(Object.keys(result.pagination)).toHaveLength(0);
    });
  });
});
