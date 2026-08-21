import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { TodoListVisualization, TodoListItem } from '@prokopai/sdk';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export const definition: ToolDefinition = {
  name: 'todoread',
  description: 'Read the current task list for the session from SQLite database.\n\nUsage:\n- Use when starting a new task or when asked to check current progress\n- Useful for tracking multi-step tasks throughout a session\n\nNotes:\n- Returns tasks sorted by priority (high → medium → low), then by creation time\n- Each task has: content, status (pending/in_progress/completed/cancelled), priority (high/medium/low)\n- Use todowrite to update the list',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 5000,
};

export async function execute(_input: Record<string, never>, ctx: ToolContext): Promise<ToolResult> {
  try {
    const dbPath = ctx.env.get('TODOS_DB_PATH') || join(homedir(), '.jean2', 'data', 'todos.db');

    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

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

      const rows = stmt.all(ctx.sessionId) as Array<{ content: string; status: string; priority: string | null }>;

      const todos = rows.map((row): TodoListItem => ({
        content: row.content,
        status: row.status as TodoListItem['status'],
        priority: (row.priority || 'medium') as TodoListItem['priority'],
      }));

      const visualization: TodoListVisualization = {
        type: 'todo-list',
        title: 'Todo List',
        items: todos,
      };

      return { success: true, result: { todos }, visualization };
    } finally {
      db.close();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`todoread failed: ${message}`);
    return { success: false, error: message };
  }
}
