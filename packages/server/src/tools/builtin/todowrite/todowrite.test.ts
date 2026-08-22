import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { definition, execute } from './tool';
import type { ToolContext } from '@prokopai/sdk';
import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DB_DIR = join(tmpdir(), 'jean2-test-todowrite-' + process.pid);
const TEST_DB_PATH = join(TEST_DB_DIR, 'todos.db');

let ctx: ToolContext;

beforeEach(() => {
  mkdirSync(TEST_DB_DIR, { recursive: true });
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

describe('todowrite tool definition', () => {
  test('has correct name', () => {
    expect(definition.name).toBe('todowrite');
  });

  test('has required todos input', () => {
    const schema = definition.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.required).toContain('todos');
  });
});

// ══════════════════════════════════════════════════════════════════
// Input Validation
// ══════════════════════════════════════════════════════════════════

describe('todowrite: validation', () => {
  test('rejects empty content', async () => {
    const result = await execute({
      todos: [{ content: '', status: 'pending' }],
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('content');
  });

  test('rejects invalid status', async () => {
    const result = await execute({
      todos: [{ content: 'test', status: 'invalid' as unknown as 'pending' }],
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid status');
  });

  test('rejects invalid priority', async () => {
    const result = await execute({
      todos: [{ content: 'test', status: 'pending', priority: 'urgent' as unknown as 'high' }],
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid priority');
  });
});

// ══════════════════════════════════════════════════════════════════
// Writing Todos
// ══════════════════════════════════════════════════════════════════

describe('todowrite: writing todos', () => {
  test('writes todos to database', async () => {
    const result = await execute({
      todos: [
        { content: 'Task 1', status: 'pending', priority: 'high' },
        { content: 'Task 2', status: 'in_progress' },
      ],
    }, ctx);
    expect(result.success).toBe(true);
    const res = result.result as { count: number };
    expect(res.count).toBe(2);

    // Verify in DB
    const db = new Database(TEST_DB_PATH);
    const rows = db.prepare('SELECT * FROM todos WHERE session_id = ?').all('test-session-123');
    db.close();
    expect(rows.length).toBe(2);
  });

  test('replaces existing todos for session', async () => {
    // Write initial todos
    await execute({
      todos: [{ content: 'Old task', status: 'pending' }],
    }, ctx);

    // Write new todos
    await execute({
      todos: [
        { content: 'New task 1', status: 'pending' },
        { content: 'New task 2', status: 'completed' },
      ],
    }, ctx);

    const db = new Database(TEST_DB_PATH);
    const rows = db.prepare('SELECT * FROM todos WHERE session_id = ?').all('test-session-123');
    db.close();
    expect(rows.length).toBe(2);
  });

  test('defaults priority to medium when not provided', async () => {
    await execute({
      todos: [{ content: 'Default priority', status: 'pending' }],
    }, ctx);

    const db = new Database(TEST_DB_PATH);
    const row = db.prepare('SELECT priority FROM todos WHERE session_id = ?').get('test-session-123') as { priority: string };
    db.close();
    expect(row.priority).toBe('medium');
  });

  test('accepts all valid statuses', async () => {
    const statuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    for (const status of statuses) {
      // Use a unique DB for each iteration to avoid conflicts
      const uniqueDbPath = TEST_DB_PATH + '.' + status;
      const uniqueCtx = {
        ...ctx,
        env: {
          get: (key: string) => key === 'TODOS_DB_PATH' ? uniqueDbPath : undefined,
          require: (_key: string) => { throw new Error('Not set'); },
        },
      };
      const result = await execute({
        todos: [{ content: `Task ${status}`, status: status as 'pending' | 'in_progress' | 'completed' | 'cancelled' }],
      }, uniqueCtx);
      expect(result.success).toBe(true);
      // Cleanup
      try { rmSync(uniqueDbPath); } catch { /* ok */ }
    }
  });

  test('returns todo-list visualization', async () => {
    const result = await execute({
      todos: [{ content: 'Task', status: 'pending', priority: 'high' }],
    }, ctx);
    expect(result.visualization).toBeDefined();
    expect(result.visualization?.type).toBe('todo-list');
  });
});
