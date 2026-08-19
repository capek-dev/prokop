import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ClosableStore,
  CreateToolOutputArtifact,
  ToolOutputArtifact,
  ToolOutputArtifactPage,
  ToolOutputArtifactStore,
} from './contracts';

export const DEFAULT_TOOL_OUTPUT_PAGE_CHARS = 10_000;
export const MAX_TOOL_OUTPUT_PAGE_CHARS = 20_000;

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

export function isToolOutputArtifactId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

export function buildToolOutputArtifactPage(
  artifact: ToolOutputArtifact,
  offset = 0,
  limit = DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
): ToolOutputArtifactPage {
  const safeOffset = Number.isInteger(offset) && offset >= 0 ? Math.min(offset, artifact.size) : 0;
  const safeLimit = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_TOOL_OUTPUT_PAGE_CHARS)
    : DEFAULT_TOOL_OUTPUT_PAGE_CHARS;
  const content = artifact.content.slice(safeOffset, safeOffset + safeLimit);
  const consumed = safeOffset + content.length;
  const complete = consumed >= artifact.size;
  return {
    artifactId: artifact.id,
    toolCallId: artifact.toolCallId,
    toolName: artifact.toolName,
    format: artifact.format,
    content,
    offset: safeOffset,
    limit: safeLimit,
    totalChars: artifact.size,
    nextOffset: complete ? null : consumed,
    complete,
  };
}

function createArtifact(input: CreateToolOutputArtifact): ToolOutputArtifact {
  return {
    id: randomUUID(),
    sessionId: input.sessionId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    content: input.content,
    format: input.format,
    size: input.content.length,
    createdAt: Date.now(),
  };
}

export function createInMemoryToolOutputArtifactStore(): ToolOutputArtifactStore {
  const artifacts = new Map<string, ToolOutputArtifact>();
  return {
    async create(input) {
      const artifact = createArtifact(input);
      artifacts.set(artifact.id, copy(artifact));
      return copy(artifact);
    },
    async getPage(sessionId, artifactId, offset, limit) {
      if (!isToolOutputArtifactId(artifactId)) return null;
      const artifact = artifacts.get(artifactId);
      if (!artifact || artifact.sessionId !== sessionId) return null;
      return buildToolOutputArtifactPage(artifact, offset, limit);
    },
  };
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
