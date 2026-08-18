import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { createTestSession } from '#tests/factories';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaces,
  deleteWorkspace,
  type CreateWorkspaceInput,
} from '@/infrastructure/sqlite/workspaces';
import { createSession, getSession, listSessionsByWorkspace } from '@/infrastructure/sqlite/session-store';

describe('test infrastructure smoke test', () => {
  beforeEach(() => {
    setupTestDatabase();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  describe('database setup', () => {
    test('creates an in-memory database with all tables', () => {
      const db = setupTestDatabase();
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('workspaces');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('messages');
      expect(tableNames).toContain('parts');
      expect(tableNames).toContain('permission_grants');
      expect(tableNames).toContain('pending_asks');
      expect(tableNames).toContain('queued_messages');
      expect(tableNames).toContain('attachments');
      expect(tableNames).toContain('terminal_sessions');
    });

    test('each setupTestDatabase call creates an isolated database', () => {
      const db1 = setupTestDatabase();
      const input: CreateWorkspaceInput = {
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/tmp/ws1',
        isVirtual: false,
      };
      createWorkspace(input);
      expect(getWorkspace('ws-1')).toBeDefined();

      const db2 = setupTestDatabase();
      expect(db2).not.toBe(db1);
      expect(getWorkspace('ws-1')).toBeNull();
    });
  });

  describe('workspace CRUD', () => {
    test('creates and retrieves a workspace', () => {
      const input: CreateWorkspaceInput = {
        id: 'test-ws',
        name: 'Test Workspace',
        path: '/tmp/test',
        isVirtual: false,
      };
      const workspace = createWorkspace(input);

      expect(workspace.id).toBe('test-ws');
      expect(workspace.name).toBe('Test Workspace');
      expect(workspace.path).toBe('/tmp/test');
      expect(workspace.isVirtual).toBe(false);

      const retrieved = getWorkspace('test-ws');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe('test-ws');
    });

    test('lists workspaces', () => {
      createWorkspace({ id: 'ws-1', name: 'WS 1', path: '/tmp/1', isVirtual: false });
      createWorkspace({ id: 'ws-2', name: 'WS 2', path: '/tmp/2', isVirtual: false });

      const workspaces = listWorkspaces();
      expect(workspaces).toHaveLength(2);
    });

    test('deletes a workspace', () => {
      createWorkspace({ id: 'ws-del', name: 'To Delete', path: '/tmp/del', isVirtual: false });
      expect(getWorkspace('ws-del')).not.toBeNull();

      const deleted = deleteWorkspace('ws-del');
      expect(deleted).toBe(true);
      expect(getWorkspace('ws-del')).toBeNull();
    });
  });

  describe('session CRUD', () => {
    test('creates and retrieves a session within a workspace', () => {
      createWorkspace({
        id: 'test-ws',
        name: 'Test Workspace',
        path: '/tmp/test',
        isVirtual: false,
      });

      const sessionInput = createTestSession({ workspaceId: 'test-ws' });
      const session = createSession(sessionInput);

      expect(session.id).toBe(sessionInput.id);
      expect(session.workspaceId).toBe('test-ws');
      expect(session.status).toBe('active');

      const retrieved = getSession(sessionInput.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(sessionInput.id);
    });

    test('lists sessions by workspace', () => {
      createWorkspace({
        id: 'test-ws',
        name: 'Test Workspace',
        path: '/tmp/test',
        isVirtual: false,
      });

      createSession(createTestSession({ workspaceId: 'test-ws' }));
      createSession(createTestSession({ workspaceId: 'test-ws' }));

      const sessions = listSessionsByWorkspace('test-ws');
      expect(sessions).toHaveLength(2);
    });

    test('deleting workspace cascades to sessions', () => {
      createWorkspace({
        id: 'test-ws',
        name: 'Test Workspace',
        path: '/tmp/test',
        isVirtual: false,
      });

      const session = createSession(createTestSession({ workspaceId: 'test-ws' }));
      expect(getSession(session.id)).not.toBeNull();

      deleteWorkspace('test-ws');
      expect(getSession(session.id)).toBeNull();
    });
  });

  describe('test factories', () => {
    test('createTestSession generates valid session with defaults', () => {
      const session = createTestSession();

      expect(session.id).toBeDefined();
      expect(session.workspaceId).toBe('test-workspace');
      expect(session.status).toBe('active');
      expect(session.title).toBe('Test Session');
    });

    test('createTestSession allows overrides', () => {
      const session = createTestSession({ title: 'Custom Title', status: 'closed' });

      expect(session.title).toBe('Custom Title');
      expect(session.status).toBe('closed');
      expect(session.workspaceId).toBe('test-workspace');
    });
  });
});
