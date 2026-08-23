import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { DiffVisualization, DiffChange } from '@prokopai/sdk';
import { createFilePermissionAsk } from '@prokopai/sdk';

const REVISION_RE = /^sha256:[0-9a-f]{64}$/;

function computeRevision(content: string | Uint8Array): string {
  const hash = createHash('sha256');
  hash.update(content);
  return `sha256:${hash.digest('hex')}`;
}

function isValidRevision(value: string): boolean {
  return REVISION_RE.test(value);
}

function dominantLineEnding(content: string): '\r\n' | '\n' {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\r' && content[i + 1] === '\n') {
      crlf++;
      i++;
    } else if (content[i] === '\n') {
      lf++;
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

interface RangeEdit {
  startLine: number;
  endLine: number;
  newString: string;
}

interface Input {
  path: string;
  revision: string;
  edits: RangeEdit[];
}

interface EditRangeResult {
  path: string;
  previousRevision: string;
  revision: string;
  editsApplied: number;
  ranges: Array<{ startLine: number; endLine: number }>;
}

interface EditRangeFailureResult {
  code: 'INVALID_INPUT' | 'FILE_NOT_FOUND' | 'STALE_REVISION';
  path: string;
  expectedRevision?: string;
  actualRevision?: string;
  editIndex?: number;
}

function failure(
  code: EditRangeFailureResult['code'],
  path: string,
  error: string,
  extra?: Partial<Omit<EditRangeFailureResult, 'code' | 'path'>>,
): ToolResult {
  return { success: false, error, result: { code, path, ...extra } satisfies EditRangeFailureResult };
}

const DIFF_CONTEXT = 3;

export const definition: ToolDefinition = {
  name: 'edit-range',
  description: `Revision-aware range editing using line numbers.

Use edit-range when you have read numbered lines and can identify the target range but cannot reliably reproduce the existing source text. This tool edits one file per call. Multiple ranges in the same file are applied atomically in one write.

## When to use

- The model has read the file and can cite stable line numbers.
- Copying existing text verbatim (as edit requires) is unreliable.

## When NOT to use

- One small targeted replacement - use edit instead.
- Several replacements better expressed as old/new strings - use multiedit.
- New file or full rewrite - use write-file.

## Parameters

- path (required): Absolute path to the file to edit.
- revision (required): The revision returned by the most recent read-file of this file. The edit fails before writing if the file changed since that read.
- edits (required): One or more ranges to replace.

Each range:

- startLine (required): 1-based start line, inclusive.
- endLine (required): 1-based end line, inclusive. Must be >= startLine.
- newString (required): The replacement text. Use an empty string to delete the range.

Line numbers are 1-based and inclusive, exactly as returned by read-file.

## Example

\`\`\`json
{
  "path": "/workspace/src/file.ts",
  "revision": "sha256:abc123...",
  "edits": [
    { "startLine": 8, "endLine": 10, "newString": "replacement lines" }
  ]
}
\`\`\`

## Rules

- Use line numbers exactly as returned by read-file.
- Supply the revision from that read.
- All ranges refer to the same original file revision, not to intermediate edited content.
- Ranges cannot overlap. Duplicate ranges are overlapping and fail.
- No range is applied when any validation fails.
- Line endings and trailing newline state outside each range are preserved.

## Permission Model

This tool requires explicit permission for:
- Files outside the workspace
- Sensitive files (.env, .pem, .key, credentials, etc.)
- Editing system directories is blocked entirely`,
  display: { summary: '{path}' },
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path to the file to edit',
      },
      revision: {
        type: 'string',
        description: 'The revision (sha256:...) returned by read-file for this file',
      },
      edits: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            startLine: {
              type: 'integer',
              minimum: 1,
              description: '1-based start line (inclusive)',
            },
            endLine: {
              type: 'integer',
              minimum: 1,
              description: '1-based end line (inclusive)',
            },
            newString: {
              type: 'string',
              description: 'The replacement text. Empty string deletes the range.',
            },
          },
          required: ['startLine', 'endLine', 'newString'],
        },
      },
    },
    required: ['path', 'revision', 'edits'],
  },
  timeout: 180000,
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    go: 'go', rs: 'rust', sh: 'bash', yaml: 'yaml', yml: 'yaml',
  };
  return langMap[ext || ''] || ext || 'text';
}

async function isBinaryFile(filePath: string, content: string): Promise<boolean> {
  const ext = '.' + (filePath.split('.').pop()?.toLowerCase() || '');
  const binaryExts = [
    '.zip', '.tar', '.gz', '.exe', '.dll', '.so', '.class', '.jar', '.war',
    '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
    '.bin', '.dat', '.obj', '.o', '.a', '.lib', '.wasm', '.pyc', '.pyo',
  ];
  if (binaryExts.includes(ext)) return true;

  const bytes = new TextEncoder().encode(content.slice(0, 4096));
  let nonPrintableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++;
    }
  }
  return bytes.length > 0 && nonPrintableCount / bytes.length > 0.3;
}

/**
 * Normalize replacement line breaks to the file's dominant line ending.
 * Handles both '\\n' and '\\r\\n' separators present in newString.
 */
function normalizeReplacementNewlines(text: string, dominant: '\r\n' | '\n'): string {
  if (text.length === 0) return '';
  const parts = text.split('\n').map(p => (p.endsWith('\r') ? p.slice(0, -1) : p));
  return parts.join(dominant);
}

function stripCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    const resolvedPath = ctx.resolvePath(input.path);

    if (ctx.isBlockedPath(resolvedPath)) {
      return failure('INVALID_INPUT', resolvedPath, `Editing system directories is not allowed: ${input.path}`);
    }

    // Permission checks consistent with edit (ToolContext is authoritative)
    const outsideWorkspace = !ctx.isWithinWorkspace(resolvedPath);
    const sensitive = ctx.isSensitivePath(resolvedPath);

    if (outsideWorkspace) {
      const permAsk = createFilePermissionAsk({
        path: input.path,
        operation: 'edit',
        risk: 'medium',
        isOutsideWorkspace: true,
      });
      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    if (sensitive) {
      const permAsk = createFilePermissionAsk({
        path: input.path,
        operation: 'edit',
        risk: 'medium',
        isSensitiveFile: true,
        reason: 'This file may contain credentials or secrets.',
      });
      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    // File must exist and be a regular text file
    const exists = await ctx.fs.exists(resolvedPath);
    if (!exists) {
      const fail: EditRangeFailureResult = { code: 'FILE_NOT_FOUND', path: resolvedPath };
      return { success: false, error: `File not found: ${resolvedPath}`, result: fail };
    }

    const stat = await ctx.fs.stat(resolvedPath);
    if (stat.isDirectory) {
      const fail: EditRangeFailureResult = {
        code: 'INVALID_INPUT',
        path: resolvedPath,
      };
      return {
        success: false,
        error: `Cannot range-edit a directory: ${resolvedPath}`,
        result: fail,
      };
    }

    const content = await ctx.fs.readFile(resolvedPath, 'utf-8');

    if (await isBinaryFile(resolvedPath, content)) {
      const fail: EditRangeFailureResult = {
        code: 'INVALID_INPUT',
        path: resolvedPath,
      };
      return {
        success: false,
        error: `Cannot range-edit a binary file: ${resolvedPath}`,
        result: fail,
      };
    }

    // Revision validation
    if (!isValidRevision(input.revision)) {
      const fail: EditRangeFailureResult = {
        code: 'INVALID_INPUT',
        path: resolvedPath,
      };
      return {
        success: false,
        error: `Invalid revision format. Expected 'sha256:' followed by 64 hex characters.`,
        result: fail,
      };
    }

    const actualRevision = computeRevision(content);
    if (actualRevision !== input.revision) {
      const fail: EditRangeFailureResult = {
        code: 'STALE_REVISION',
        path: resolvedPath,
        expectedRevision: input.revision,
        actualRevision,
      };
      return {
        success: false,
        error: 'File changed since it was read. Re-read the file and retry.',
        result: fail,
      };
    }

    // Input validation
    if (!Array.isArray(input.edits) || input.edits.length < 1) {
      const fail: EditRangeFailureResult = { code: 'INVALID_INPUT', path: resolvedPath };
      return {
        success: false,
        error: 'edits must contain at least one item.',
        result: fail,
      };
    }

    // Build logical line table (matches read-file numbering: content.split('\n'))
    const numLines = content.split('\n').length;
    const lineStarts: number[] = [0];
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') lineStarts.push(i + 1);
    }
    const dominant = dominantLineEnding(content);

    // Validate each range and compute source offsets
    interface ResolvedRange {
      startLine: number;
      endLine: number;
      newString: string;
      startOffset: number;
      endOffset: number;
    }

    const resolved: ResolvedRange[] = [];
    for (let idx = 0; idx < input.edits.length; idx++) {
      const edit = input.edits[idx];
      const { startLine, endLine, newString } = edit;

      if (
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine)
      ) {
        const fail: EditRangeFailureResult = {
          code: 'INVALID_INPUT',
          path: resolvedPath,
          editIndex: idx,
        };
        return {
          success: false,
          error: `Edit ${idx}: startLine and endLine must be integers.`,
          result: fail,
        };
      }

      if (startLine < 1) {
        const fail: EditRangeFailureResult = {
          code: 'INVALID_INPUT',
          path: resolvedPath,
          editIndex: idx,
        };
        return {
          success: false,
          error: `Edit ${idx}: startLine must be >= 1 (got ${startLine}).`,
          result: fail,
        };
      }

      if (endLine < startLine) {
        const fail: EditRangeFailureResult = {
          code: 'INVALID_INPUT',
          path: resolvedPath,
          editIndex: idx,
        };
        return {
          success: false,
          error: `Edit ${idx}: endLine (${endLine}) must be >= startLine (${startLine}).`,
          result: fail,
        };
      }

      if (endLine > numLines) {
        const fail: EditRangeFailureResult = {
          code: 'INVALID_INPUT',
          path: resolvedPath,
          editIndex: idx,
        };
        return {
          success: false,
          error: `Edit ${idx}: endLine (${endLine}) exceeds the number of logical file lines (${numLines}).`,
          result: fail,
        };
      }

      const startOffset = lineStarts[startLine - 1];
      // Consume the complete terminator of endLine for non-final lines so
      // deletions do not leave an empty line. For the final line, the retained
      // boundary is the end of content (preserves trailing-newline state).
      const endOffset = endLine < numLines ? lineStarts[endLine] : content.length;

      resolved.push({ startLine, endLine, newString, startOffset, endOffset });
    }

    // Overlap detection (ranges refer to the same original revision)
    const sortedForOverlap = [...resolved].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sortedForOverlap.length; i++) {
      const prev = sortedForOverlap[i - 1];
      const cur = sortedForOverlap[i];
      if (cur.startLine <= prev.endLine) {
        const fail: EditRangeFailureResult = {
          code: 'INVALID_INPUT',
          path: resolvedPath,
        };
        return {
          success: false,
          error: `Ranges overlap: [${prev.startLine}-${prev.endLine}] and [${cur.startLine}-${cur.endLine}]. Ranges cannot overlap.`,
          result: fail,
        };
      }
    }

    // Apply edits by descending startOffset so earlier offsets stay valid.
    // Non-final ranges consume the selected line terminator and append exactly
    // one dominant terminator after a non-empty replacement, so CRLF is
    // preserved and deletions do not leave an empty line. Final-line ranges use
    // the replacement verbatim, preserving the original trailing-newline state
    // unless newString explicitly changes it.
    const sortedDesc = [...resolved].sort((a, b) => b.startOffset - a.startOffset);

    let newContent = content;
    for (const r of sortedDesc) {
      const replacement = normalizeReplacementNewlines(r.newString, dominant);
      const isFinalRange = r.endLine >= numLines;
      const insertText = isFinalRange
        ? replacement
        : replacement.length > 0
          ? replacement + dominant
          : '';
      newContent = newContent.slice(0, r.startOffset) + insertText + newContent.slice(r.endOffset);
    }

    await ctx.fs.writeFile(resolvedPath, newContent);

    const newRevision = computeRevision(newContent);
    const rangesReport = sortedForOverlap.map(r => ({ startLine: r.startLine, endLine: r.endLine }));

    const result: EditRangeResult = {
      path: resolvedPath,
      previousRevision: actualRevision,
      revision: newRevision,
      editsApplied: resolved.length,
      ranges: rangesReport,
    };

    const visualization = buildDiffVisualization(
      resolvedPath,
      content,
      sortedForOverlap,
      numLines,
      dominant
    );

    return { success: true, result, visualization };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Build one combined diff visualization with one hunk per edited range.
 * Line content has trailing carriage returns stripped for display only.
 */
function buildDiffVisualization(
  resolvedPath: string,
  oldContent: string,
  ranges: Array<{ startLine: number; endLine: number; newString: string }>,
  numLines: number,
  dominant: '\r\n' | '\n'
): DiffVisualization {
  const oldLines = oldContent.split('\n').map(stripCR);

  // Precompute the new-string line counts (after newline normalization) per range,
  // and the cumulative line delta up to each range.
  const rangeNewCounts = ranges.map(r => {
    const normalized = normalizeReplacementNewlines(r.newString, dominant);
    return normalized.length === 0 ? 0 : normalized.split('\n').length;
  });

  const hunks: NonNullable<DiffVisualization['hunks']> = [];
  let delta = 0;
  let additions = 0;
  let deletions = 0;

  for (let ri = 0; ri < ranges.length; ri++) {
    const range = ranges[ri];
    const oldRangeCount = range.endLine - range.startLine + 1;
    const newRangeCount = rangeNewCounts[ri];
    const deltaBefore = delta;
    const deltaAfter = delta + (newRangeCount - oldRangeCount);

    const prevEnd = ri > 0 ? ranges[ri - 1].endLine : 0;
    const nextStart = ri < ranges.length - 1 ? ranges[ri + 1].startLine : Number.MAX_SAFE_INTEGER;

    const ctxBeforeStart = Math.max(prevEnd + 1, range.startLine - DIFF_CONTEXT);
    const ctxAfterEnd = Math.min(nextStart - 1, range.endLine + DIFF_CONTEXT, numLines);

    const changes: DiffChange[] = [];
    let oldLineNum = ctxBeforeStart;
    let newLineNum = ctxBeforeStart + deltaBefore;

    // Context before
    for (let L = ctxBeforeStart; L < range.startLine; L++) {
      changes.push({
        type: 'context',
        content: oldLines[L - 1] ?? '',
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
      oldLineNum++;
      newLineNum++;
    }

    // Removed lines
    for (let L = range.startLine; L <= range.endLine; L++) {
      changes.push({
        type: 'removed',
        content: oldLines[L - 1] ?? '',
        oldLineNumber: oldLineNum,
      });
      oldLineNum++;
      deletions++;
    }

    // Added lines
    const normalized = normalizeReplacementNewlines(range.newString, dominant);
    const addedLineTexts = normalized.length === 0 ? [] : normalized.split('\n').map(stripCR);
    for (const text of addedLineTexts) {
      changes.push({
        type: 'added',
        content: text,
        newLineNumber: newLineNum,
      });
      newLineNum++;
      additions++;
    }

    // Context after
    for (let L = range.endLine + 1; L <= ctxAfterEnd; L++) {
      changes.push({
        type: 'context',
        content: oldLines[L - 1] ?? '',
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
      oldLineNum++;
      newLineNum++;
    }

    hunks.push({
      oldStart: ctxBeforeStart,
      oldLines: oldLineNum - ctxBeforeStart,
      newStart: ctxBeforeStart + deltaBefore,
      newLines: newLineNum - (ctxBeforeStart + deltaBefore),
      changes,
    });

    delta = deltaAfter;
  }

  return {
    type: 'diff',
    path: resolvedPath,
    language: detectLanguage(resolvedPath),
    hunks,
    additions,
    deletions,
  };
}
