import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { TodoListVisualization, TodoListItem } from '@prokopai/sdk';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getDataDir } from '@/infrastructure/runtime/paths';

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

interface TodoInput {
  content: string;
  status: string;
  priority?: string;
}

interface Input {
  todos?: TodoInput[];
}

function openDb(ctx: ToolContext): Database {
  const dbPath = ctx.env.get('TODOS_DB_PATH') || join(getDataDir(), 'data', 'todos.db');
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'medium',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id)');
  return db;
}

function readTodos(db: Database, sessionId: string): TodoListItem[] {
  const stmt = db.prepare(`
    SELECT id, session_id, content, status, priority, created_at, updated_at
    FROM todos
    WHERE session_id = ?
    ORDER BY
      CASE priority
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'low' THEN 2
      END,
      created_at ASC
  `);
  const rows = stmt.all(sessionId) as Array<{ content: string; status: string; priority: string | null }>;
  return rows.map((row): TodoListItem => ({
    content: row.content,
    status: row.status as TodoListItem['status'],
    priority: (row.priority || 'medium') as TodoListItem['priority'],
  }));
}

function visualizationFor(todos: TodoListItem[]): TodoListVisualization {
  return { type: 'todo-list', title: 'Todo List', items: todos };
}

export const definition: ToolDefinition = {
  name: 'todo',
  description: `Read or update the task list for the current session in SQLite database.

Usage:
- Call without todos to read the current list
- Call with a complete new list to replace the existing one
- Set status to 'in_progress' for the task currently being worked on
- Set status to 'completed' when a task is done
- Set status to 'cancelled' for abandoned tasks

Parameters:
- todos (optional): Array of { content, status, priority? }. Omit to read the current list.
- content: Brief description of the task
- status: pending | in_progress | completed | cancelled
- priority: high | medium (default) | low

When to use:
- Track complex multi-step tasks
- Show progress to user
- Mark current work item

When NOT to use:
- Simple single tasks that don't need tracking
- Replace the list unnecessarily`,
  display: { summary: '{todos ? todos.length + " todos" : "todos"}' },
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: {
              type: 'string',
              enum: VALID_STATUSES,
            },
            priority: {
              type: 'string',
              enum: VALID_PRIORITIES,
            },
          },
          required: ['content', 'status'],
        },
        description: 'Array of todo items to write; omit to read the current list',
      },
    },
  },
  timeout: 30000,
};

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  const db = openDb(ctx);
  try {
    if (input.todos === undefined) {
      // Read mode
      const todos = readTodos(db, ctx.sessionId);
      return { success: true, result: { todos }, visualization: visualizationFor(todos) };
    }

    // Write mode: validate then replace
    if (!Array.isArray(input.todos)) {
      return { success: false, error: 'todos must be an array when provided' };
    }
    for (let i = 0; i < input.todos.length; i++) {
      const item = input.todos[i];
      if (typeof item?.content !== 'string' || !item.content.trim()) {
        return { success: false, error: `todos[${i}].content must be a non-empty string` };
      }
      if (!VALID_STATUSES.includes(item.status)) {
        return { success: false, error: `todos[${i}].status must be one of: ${VALID_STATUSES.join(', ')}` };
      }
      if (item.priority !== undefined && !VALID_PRIORITIES.includes(item.priority)) {
        return { success: false, error: `todos[${i}].priority must be one of: ${VALID_PRIORITIES.join(', ')}` };
      }
    }

    const now = Date.now();
    const write = db.transaction(() => {
      db.run('DELETE FROM todos WHERE session_id = ?', [ctx.sessionId]);
      const insert = db.prepare(`
        INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of input.todos!) {
        insert.run(crypto.randomUUID(), ctx.sessionId, item.content.trim(), item.status, item.priority ?? 'medium', now, now);
      }
    });
    write();

    const todos = readTodos(db, ctx.sessionId);
    return { success: true, result: { todos, written: input.todos.length }, visualization: visualizationFor(todos) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`todo failed: ${message}`);
    return { success: false, error: message };
  } finally {
    db.close();
  }
}
