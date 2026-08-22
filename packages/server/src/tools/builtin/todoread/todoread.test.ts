import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { definition, execute } from './tool';
import type { ToolContext } from '@prokopai/sdk';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use a temp directory for the test database
const TEST_DB_DIR = join(tmpdir(), 'jean2-test-todoread-' + process.pid);
const TEST_DB_PATH = join(TEST_DB_DIR, 'todos.db');

let ctx: ToolContext;

beforeEach(() => {
  // Create a fresh test directory
  mkdirSync(TEST_DB_DIR, { recursive: true });
  // Remove any existing test DB
  try { rmSync(TEST_DB_PATH); } catch { /* ok */ }

  ctx = {
    sessionId: 'test-session-123',
    workspacePath: '/workspace/project',
    workspaceId: 'ws-1',
    abortSignal: new AbortController().signal,
    allowedPaths: [],
    fs: {} as ToolContext['fs'],
    llm: {} as ToolContext['llm'],
    ask: mock(async () => true) as unknown as ToolContext['ask'],
    env: {
      get: (key: string) => key === 'TODOS_DB_PATH' ? TEST_DB_PATH : undefined,
      require: (_key: string) => { throw new Error('Not set'); },
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock(() => {}),
      error: mock(() => {}),
    },
    fetch: globalThis.fetch,
    resolvePath: (p: string) => p,
    isWithinWorkspace: () => true,
    isSensitivePath: () => false,
    isBlockedPath: () => false,
    addWorkspacePath: async () => true,
    removeWorkspacePath: async () => true,
  };
});

afterEach(() => {
  try { rmSync(TEST_DB_DIR, { recursive: true }); } catch { /* ok */ }
});

// ══════════════════════════════════════════════════════════════════
// Tool Definition
// ══════════════════════════════════════════════════════════════════

describe('todoread tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('todoread');
  });

  test('has no required inputs', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties).length).toBe(0);
  });

  test('has 5 second timeout', () => {
    expect(definition.timeout).toBe(5000);
  });
});

// ══════════════════════════════════════════════════════════════════
// Reading Todos
// ══════════════════════════════════════════════════════════════════

describe('todoread: reading todos', () => {
  test('returns empty list when no todos exist', async () => {
    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const todos = (result.result as { todos: unknown[] }).todos;
    expect(todos.length).toBe(0);
  });

  test('returns todos for the session', async () => {
    // Seed some todos directly
    const db = new Database(TEST_DB_PATH);
    db.run('PRAGMA journal_mode = WAL');
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const now = Date.now();
    db.run('INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['id1', 'test-session-123', 'Task 1', 'pending', 'high', now, now]);
    db.run('INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['id2', 'test-session-123', 'Task 2', 'completed', 'low', now + 1, now + 1]);
    db.close();

    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const todos = (result.result as { todos: Array<{ content: string; status: string; priority: string }> }).todos;
    expect(todos.length).toBe(2);
    // High priority should come first
    expect(todos[0].content).toBe('Task 1');
    expect(todos[0].priority).toBe('high');
    expect(todos[1].content).toBe('Task 2');
  });

  test('does not return todos from other sessions', async () => {
    const db = new Database(TEST_DB_PATH);
    db.run('PRAGMA journal_mode = WAL');
    db.run(`CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const now = Date.now();
    db.run('INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['id1', 'other-session', 'Other Task', 'pending', 'high', now, now]);
    db.close();

    const result = await execute({}, ctx);
    expect(result.success).toBe(true);
    const todos = (result.result as { todos: unknown[] }).todos;
    expect(todos.length).toBe(0);
  });

  test('returns todo-list visualization', async () => {
    const result = await execute({}, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('todo-list');
  });
});
