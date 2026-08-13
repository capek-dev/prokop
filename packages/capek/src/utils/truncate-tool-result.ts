import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';

const MAX_RESULT_CHARS = 50_000;
const PREVIEW_CHARS = 10_000;
const JEAN2_TEMP_DIR = path.join(os.tmpdir(), 'jean2');

export function truncateToolResult(
  result: unknown,
  sessionId: string,
  toolName: string,
): unknown {
  const serialized = JSON.stringify(result);

  if (serialized.length <= MAX_RESULT_CHARS) {
    return result;
  }

  const dir = path.join(JEAN2_TEMP_DIR, sessionId);
  mkdirSync(dir, { recursive: true });

  const sanitizedToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `${dir}/${sanitizedToolName}-${Date.now()}.json`;
  writeFileSync(filePath, serialized);

  if (typeof result === 'string') {
    const preview = result.slice(0, PREVIEW_CHARS);
    const note = `\n\n[Result truncated: ${result.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`;
    return preview + note;
  }

  const truncatedJson = serialized.slice(0, PREVIEW_CHARS);

  try {
    const partialResult = JSON.parse(truncatedJson) as Record<string, unknown>;
    const note = `[Result truncated: ${serialized.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`;

    if (partialResult && typeof partialResult === 'object' && !Array.isArray(partialResult)) {
      if (typeof partialResult.content === 'string') {
        partialResult.content = (partialResult.content as string).slice(0, PREVIEW_CHARS - note.length) + note;
      } else {
        partialResult._truncatedNote = note;
      }
      partialResult._persisted = true;
      partialResult._filePath = filePath;
      partialResult._originalSize = serialized.length;
      return partialResult;
    }

    return {
      ...partialResult,
      _persisted: true,
      _filePath: filePath,
      _originalSize: serialized.length,
    };
  } catch {
    return {
      content: truncatedJson + `\n\n[Result truncated: ${serialized.length} chars total. Full result persisted to ${filePath}. Use read-file tool to read it.]`,
      _persisted: true,
      _filePath: filePath,
      _originalSize: serialized.length,
    };
  }
}
