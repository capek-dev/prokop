import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { TodoListVisualization } from '@prokopai/sdk';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'high' | 'medium' | 'low';
}

interface Input {
  todos: TodoItem[];
}

const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

export const definition: ToolDefinition = {
  name: 'todowrite',
  description: 'Update the task list for the current session in SQLite database.\n\nUsage:\n- Call with complete new list (replaces existing)\n- Set status to \'in_progress\' for the task currently being worked on\n- Set status to \'completed\' when a task is done\n- Set status to \'cancelled\' for abandoned tasks\n\nParameters:\n- todos (required): Array of { content, status, priority? }\n- content: Brief description of the task\n- status: pending | in_progress | completed | cancelled\n- priority: high | medium (default) | low\n\nWhen to use:\n- Track complex multi-step tasks\n- Show progress to user\n- Mark current work item\n\nWhen NOT to use:\n- Simple single tasks that don\'t need tracking\n- Replace the list unnecessarily',
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
        },
        description: 'Array of todo items to write',
      },
    },
    required: ['todos'],
  },
  timeout: 30000,
};

function validateInput(input: unknown): { ok: true; data: Input } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'invalid input: expected object' };
  }

  const data = input as { todos?: unknown };

  if (!Array.isArray(data.todos)) {
    return { ok: false, error: 'todos must be an array' };
  }

  for (let i = 0; i < data.todos.length; i++) {
    const todo = data.todos[i] as { content?: string; status?: string; priority?: string };

    if (typeof todo.content !== 'string' || todo.content.trim() === '') {
      return { ok: false, error: 'each todo must have content' };
    }

    const status = todo.status;
    if (!status || !VALID_STATUSES.includes(status)) {
      return { ok: false, error: `invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(', ')}` };
    }

    const priority = todo.priority;
    if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
      return { ok: false, error: `invalid priority: ${priority}. Must be one of: ${VALID_PRIORITIES.join(', ')}` };
    }
  }

  return { ok: true, data: input as Input };
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  const validated = validateInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  const { todos } = validated.data;

  try {
    const dbPath = ctx.env.get('TODOS_DB_PATH') || join(homedir(), '.jean2', 'data', 'todos.db');
    const dbDir = dirname(dbPath);

    mkdirSync(dbDir, { recursive: true });

    const db = new Database(dbPath);
    db.run('PRAGMA journal_mode = WAL');

    try {
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

      db.prepare('DELETE FROM todos WHERE session_id = ?').run(ctx.sessionId);

      const now = Date.now();
      const insertStmt = db.prepare(
        'INSERT INTO todos (id, session_id, content, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );

      for (const todo of todos) {
        const id = randomUUID();
        const priority = todo.priority || 'medium';
        insertStmt.run(id, ctx.sessionId, todo.content, todo.status, priority, now, now);
      }

      const normalizedTodos = todos.map((todo) => ({
        content: todo.content,
        status: todo.status,
        priority: todo.priority || 'medium',
      }));

      const visualization: TodoListVisualization = {
        type: 'todo-list',
        title: 'Todo List',
        items: normalizedTodos,
      };

      return { success: true, result: { count: todos.length }, visualization };
    } finally {
      db.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
