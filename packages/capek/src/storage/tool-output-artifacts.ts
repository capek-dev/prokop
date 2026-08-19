import { randomUUID } from 'node:crypto';
import type {
  CreateToolOutputArtifact,
  ToolOutputArtifact,
  ToolOutputArtifactPage,
  ToolOutputArtifactStore,
} from './contracts';

export const DEFAULT_TOOL_OUTPUT_PAGE_CHARS = 10_000;
export const MAX_TOOL_OUTPUT_PAGE_CHARS = 20_000;

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

export function createArtifact(input: CreateToolOutputArtifact): ToolOutputArtifact {
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
