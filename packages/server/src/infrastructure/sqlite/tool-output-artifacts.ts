import { randomUUID } from 'node:crypto';
import {
  buildToolOutputArtifactPage,
  DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
  isToolOutputArtifactId,
  MAX_TOOL_OUTPUT_PAGE_CHARS,
  type CreateToolOutputArtifact,
  type ToolOutputArtifact,
  type ToolOutputArtifactPage,
  type ToolOutputArtifactStore,
} from '@/adapters/capek/contracts';
import { getDatabase } from './database';

export {
  DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
  MAX_TOOL_OUTPUT_PAGE_CHARS,
  isToolOutputArtifactId,
};

interface ArtifactRow {
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

function toArtifact(row: ArtifactRow): ToolOutputArtifact {
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

export function createToolOutputArtifact(input: CreateToolOutputArtifact): ToolOutputArtifact {
  const artifact: ToolOutputArtifact = {
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
  getDatabase().run(
    `INSERT INTO tool_output_artifacts
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
  return structuredClone(artifact);
}

export function getToolOutputArtifactPage(
  sessionId: string,
  artifactId: string,
  offset?: number,
  limit?: number,
): ToolOutputArtifactPage | null {
  if (!isToolOutputArtifactId(artifactId)) return null;
  const row = getDatabase().query(
    'SELECT * FROM tool_output_artifacts WHERE id = ? AND session_id = ?',
  ).get(artifactId, sessionId) as ArtifactRow | null;
  if (!row) return null;
  return buildToolOutputArtifactPage(toArtifact(row), offset, limit);
}

export const jean2ToolOutputArtifactStore: ToolOutputArtifactStore = {
  create: createToolOutputArtifact,
  getPage: getToolOutputArtifactPage,
};
