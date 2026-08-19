import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ClosableStore,
  ToolOutputArtifact,
  ToolOutputArtifactStore,
} from './contracts';
import {
  buildToolOutputArtifactPage,
  createArtifact,
  isToolOutputArtifactId,
} from './tool-output-artifacts';

export type SqliteToolOutputArtifactStore = ToolOutputArtifactStore & ClosableStore;

interface ToolOutputArtifactRow {
  id: string;
  session_id: string;
  workspace_id: string | null;
  tool_call_id: string;
  tool_name: string;
  content: string;
  format: ToolOutputArtifact['format'];
  size: number;
  created_at: number;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function fromRow(row: ToolOutputArtifactRow): ToolOutputArtifact {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.workspace_id ? { workspaceId: row.workspace_id } : {}),
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    content: row.content,
    format: row.format,
    size: row.size,
    createdAt: row.created_at,
  };
}

export function createSqliteToolOutputArtifactStore(options: { path: string }): SqliteToolOutputArtifactStore {
  mkdirSync(dirname(options.path), { recursive: true });
  const db = new Database(options.path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS capek_tool_output_artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      workspace_id TEXT,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES capek_sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS capek_tool_output_artifacts_session_created
      ON capek_tool_output_artifacts(session_id, created_at, id);
    CREATE INDEX IF NOT EXISTS capek_tool_output_artifacts_session_call
      ON capek_tool_output_artifacts(session_id, tool_call_id);
  `);
  let closed = false;
  return {
    async create(input) {
      const artifact = createArtifact(input);
      db.run(
        `INSERT INTO capek_tool_output_artifacts
          (id, session_id, workspace_id, tool_call_id, tool_name, content, format, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          artifact.id,
          artifact.sessionId,
          artifact.workspaceId ?? null,
          artifact.toolCallId,
          artifact.toolName,
          artifact.content,
          artifact.format,
          artifact.size,
          artifact.createdAt,
        ],
      );
      return copy(artifact);
    },
    async getPage(sessionId, artifactId, offset, limit) {
      if (!isToolOutputArtifactId(artifactId)) return null;
      const row = db.query(
        'SELECT * FROM capek_tool_output_artifacts WHERE id = ? AND session_id = ?',
      ).get(artifactId, sessionId) as ToolOutputArtifactRow | null;
      return row ? buildToolOutputArtifactPage(fromRow(row), offset, limit) : null;
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
