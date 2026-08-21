import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type {
  FileListVisualization,
  DiffHunk,
  DiffChange,
} from '@prokopai/sdk';
import { createFilePermissionAsk } from '@prokopai/sdk';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface Input {
  patch: string;
}

interface UpdateChunk {
  context?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

interface ParsedOperation {
  type: 'add' | 'update' | 'delete';
  path: string;
  moveTo?: string;
  chunks: UpdateChunk[];
  addLines: string[];
  sourceLine: number;
}

interface ReplacementTuple {
  start: number;
  end: number;
  replacement: string;
  mode: MatchMode;
  startLine: number;
  chunkIndex: number;
}

interface ComputedFile {
  op: ParsedOperation;
  sourcePath: string;
  destPath: string;
  originalContent: string | null;
  resultContent: string;
  tuples: ReplacementTuple[];
  isMove: boolean;
}

interface ApplyPatchResult {
  added: string[];
  modified: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
  matchModes: Array<{
    path: string;
    chunkIndex: number;
    mode: MatchMode;
    startLine: number;
  }>;
  diffs: Array<{ path: string; hunks: DiffHunk[]; additions: number; deletions: number }>;
}

type PatchFailureCode =
  | 'INVALID_INPUT'
  | 'PARSE_ERROR'
  | 'BLOCKED_PATH'
  | 'FILE_NOT_FOUND'
  | 'DEST_EXISTS'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'AMBIGUOUS_INSERTION'
  | 'APPLY_ERROR';

interface PatchFailureResult {
  code: PatchFailureCode;
  line?: number;
  path?: string;
  chunkIndex?: number;
  candidateLines?: number[];
  message?: string;
  rollbackErrors?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const M_UPDATE = '*** Update File: ';
const M_ADD = '*** Add File: ';
const M_DELETE = '*** Delete File: ';
const M_MOVE = '*** Move to: ';
const M_EOF = '*** End of File';
const DIFF_CONTEXT = 3;

// ---------------------------------------------------------------------------
// Tool definition (Phase 5 description)
// ---------------------------------------------------------------------------

export const definition: ToolDefinition = {
  name: 'apply-patch',
  description: `Apply a context patch to one or more files atomically.

Uses a V4A-style context patch format (NOT git unified diff). Hunk line numbers are not used and not required.

## When to use

- Multiple distant edits in one file
- Changes across multiple files at once
- Combining modifications, creations, deletions, and moves in one operation
- Complex changes that are awkward as individual search/replace edits

## When NOT to use

- One small targeted replacement - use edit
- Several replacements in one file - use multiedit
- Editing by line number - use edit-range
- A new file or full rewrite - use write-file

## Patch format

\`\`\`
*** Begin Patch
*** Update File: packages/server/src/example.ts
@@ function targetFunction(
 context line
-old line
+new line
*** Add File: packages/server/src/new-file.ts
+new file content
*** Delete File: packages/server/src/obsolete.ts
*** End Patch
\`\`\`

Supported file operations:

- \`*** Add File: <path>\` - create a new file (only \`+\` lines)
- \`*** Update File: <path>\` - modify an existing file using chunks
- \`*** Delete File: <path>\` - remove a file
- \`*** Move to: <path>\` - placed immediately after an Update header, moves the updated content to a new path and removes the source

Supported update chunk syntax:

- \`@@\` begins a chunk with no anchor
- \`@@ <context>\` begins a chunk after a semantic anchor (a line containing that text)
- Lines beginning with one space are unchanged context
- Lines beginning with \`-\` are removed
- Lines beginning with \`+\` are added
- \`*** End of File\` constrains a chunk to the end of the file

Exactly one control character is removed from each body line; the rest of the line is preserved verbatim, including blank and indented lines.

## Matching

Chunks are applied in patch order. Each chunk's removed/context lines are located with ordered, fail-closed passes (exact, then line-ending, then trailing-whitespace, then consistent indentation). A chunk is only applied when exactly one candidate is found within its search region. Ambiguous chunks fail rather than guessing. Internal whitespace is never collapsed.

A chunk with only added lines (pure insertion) is rejected unless it has a unique context anchor (insert after that anchor) or is marked \`*** End of File\` (insert at the end).

## Result

Returns lists of added, modified, deleted, and moved files, plus the match mode and start line used for each chunk.

## Permission model

Every source and destination path is checked before any write. This tool requires explicit permission for paths outside the workspace, sensitive files, and any deletion or move. Editing system directories is blocked entirely.`,
  inputSchema: {
    type: 'object',
    properties: {
      patch: {
        type: 'string',
        description: 'The V4A-style context patch content (*** Begin Patch ... *** End Patch)',
      },
    },
    required: ['patch'],
  },
  timeout: 60000,
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failure(
  code: PatchFailureCode,
  error: string,
  extra?: Omit<PatchFailureResult, 'code'>,
): ToolResult {
  return { success: false, error, result: { code, ...extra } satisfies PatchFailureResult };
}

function stripCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function computeLineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineForOffset(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let res = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      res = mid + 1;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

function endsWithNewline(s: string): boolean {
  return s.endsWith('\n');
}

// ---------------------------------------------------------------------------
// Local matching engine (fail-closed ordered passes)
//
// Design: fail-closed ordered matching. Passes run strictest first and stop at
// the first pass that produces any candidates. Zero candidates continues to the
// next pass. One candidate succeeds. More than one candidate is ambiguous and
// never falls through to a looser pass.
//
// Normalized passes map every normalized character back to an original source
// span so replacement offsets are always valid and never synthetic.
// ---------------------------------------------------------------------------

type MatchMode =
  | 'exact'
  | 'line_endings'
  | 'trailing_whitespace'
  | 'indentation'
  | 'line_start'
  | 'line_end';

interface TextMatch {
  startIndex: number;
  endIndex: number;
  startLine: number;
  endLine: number;
  mode: MatchMode;
}

interface MatchAttempt {
  mode: MatchMode;
  count: number;
}

interface MatchSearchResult {
  matches: TextMatch[];
  attempts: MatchAttempt[];
  usedMode?: MatchMode;
  ambiguous: boolean;
}

interface NormalizedText {
  text: string;
  originalStartByIndex: number[];
  originalEndByIndex: number[];
}

interface RawLine {
  text: string;
  term: string;
}

interface ContentLine extends RawLine {
  start: number;
  textEnd: number;
  end: number;
}

const ORDERED_PASSES: MatchMode[] = [
  'exact',
  'line_endings',
  'trailing_whitespace',
  'indentation',
];

function toTextMatch(
  lineStarts: number[],
  startIndex: number,
  endIndex: number,
  mode: MatchMode,
): TextMatch {
  const startLine = lineForOffset(lineStarts, startIndex);
  const endLine = endIndex > startIndex ? lineForOffset(lineStarts, endIndex - 1) : startLine;
  return { startIndex, endIndex, startLine, endLine, mode };
}

function splitLinesRaw(str: string): RawLine[] {
  const out: RawLine[] = [];
  const n = str.length;
  let start = 0;
  let i = 0;
  while (i < n) {
    if (str[i] === '\n') {
      out.push({ text: str.slice(start, i), term: '\n' });
      i++;
      start = i;
    } else if (str[i] === '\r' && str[i + 1] === '\n') {
      out.push({ text: str.slice(start, i), term: '\r\n' });
      i += 2;
      start = i;
    } else if (str[i] === '\r') {
      out.push({ text: str.slice(start, i), term: '\r' });
      i++;
      start = i;
    } else {
      i++;
    }
  }
  out.push({ text: str.slice(start), term: '' });
  return out;
}

function buildContentLines(content: string): ContentLine[] {
  const raw = splitLinesRaw(content);
  let offset = 0;
  return raw.map((r) => {
    const line: ContentLine = {
      text: r.text,
      term: r.term,
      start: offset,
      textEnd: offset + r.text.length,
      end: offset + r.text.length + r.term.length,
    };
    offset = line.end;
    return line;
  });
}

function leadingWhitespace(text: string): string {
  const m = text.match(/^[ \t]*/);
  return m ? m[0] : '';
}

function findExactMatches(content: string, search: string, lineStarts: number[]): TextMatch[] {
  const matches: TextMatch[] = [];
  if (search.length === 0) return matches;
  let cursor = 0;
  while (cursor <= content.length - search.length) {
    const idx = content.indexOf(search, cursor);
    if (idx === -1) break;
    matches.push(toTextMatch(lineStarts, idx, idx + search.length, 'exact'));
    cursor = idx + search.length;
  }
  return matches;
}

function buildLineEndingsNormalized(content: string): NormalizedText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const ch = content[i];
    if (ch === '\r' && content[i + 1] === '\n') {
      chars.push('\n');
      starts.push(i);
      ends.push(i + 2);
      i += 2;
    } else if (ch === '\n') {
      chars.push('\n');
      starts.push(i);
      ends.push(i + 1);
      i++;
    } else {
      chars.push(ch);
      starts.push(i);
      ends.push(i + 1);
      i++;
    }
  }
  return { text: chars.join(''), originalStartByIndex: starts, originalEndByIndex: ends };
}

function buildTrailingWsNormalized(content: string): NormalizedText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    const ch = content[i];
    if (ch === ' ' || ch === '\t') {
      let j = i;
      while (j < n && (content[j] === ' ' || content[j] === '\t')) j++;
      const atLineEnd = j >= n || content[j] === '\n' || content[j] === '\r';
      if (atLineEnd) {
        i = j;
      } else {
        for (let k = i; k < j; k++) {
          chars.push(content[k]);
          starts.push(k);
          ends.push(k + 1);
        }
        i = j;
      }
    } else if (ch === '\r' && content[i + 1] === '\n') {
      chars.push('\n');
      starts.push(i);
      ends.push(i + 2);
      i += 2;
    } else {
      chars.push(ch);
      starts.push(i);
      ends.push(i + 1);
      i++;
    }
  }
  return { text: chars.join(''), originalStartByIndex: starts, originalEndByIndex: ends };
}

function findNormalizedMatches(
  content: string,
  search: string,
  build: (s: string) => NormalizedText,
  mode: MatchMode,
): TextMatch[] {
  const matches: TextMatch[] = [];
  if (search.length === 0) return matches;
  const c = build(content);
  const s = build(search);
  if (s.text.length === 0) return matches;
  const lineStarts = computeLineStarts(content);
  let cursor = 0;
  while (cursor <= c.text.length - s.text.length) {
    const idx = c.text.indexOf(s.text, cursor);
    if (idx === -1) break;
    const normEnd = idx + s.text.length;
    const startIndex = c.originalStartByIndex[idx];
    const endIndex = c.originalEndByIndex[normEnd - 1];
    matches.push(toTextMatch(lineStarts, startIndex, endIndex, mode));
    cursor = normEnd;
  }
  return matches;
}

function buildShiftedSearch(
  lines: RawLine[],
  delta: number,
): string | null {
  let out = '';
  for (const ln of lines) {
    const ws = leadingWhitespace(ln.text);
    const body = ln.text.slice(ws.length);
    if (body.length === 0) {
      out += ln.text + ln.term;
      continue;
    }
    let newWs: string;
    if (delta >= 0) {
      newWs = ' '.repeat(delta) + ws;
    } else {
      const remove = -delta;
      if (ws.length < remove) return null;
      newWs = ws.slice(0, ws.length - remove);
    }
    out += newWs + body + ln.term;
  }
  return out;
}

function findIndentationMatches(content: string, search: string): TextMatch[] {
  if (search.length === 0) return [];
  const lineStarts = computeLineStarts(content);
  const searchLines = splitLinesRaw(search);
  const nonBlankIdx: number[] = [];
  for (let i = 0; i < searchLines.length; i++) {
    const ws = leadingWhitespace(searchLines[i].text);
    if (searchLines[i].text.slice(ws.length).length > 0) nonBlankIdx.push(i);
  }
  if (nonBlankIdx.length === 0) return [];
  const baseIndent = leadingWhitespace(searchLines[nonBlankIdx[0]].text).length;

  const contentLines = buildContentLines(content);
  const candidateDeltas = new Set<number>();
  for (const cl of contentLines) {
    candidateDeltas.add(leadingWhitespace(cl.text).length - baseIndent);
  }

  const results: TextMatch[] = [];
  const seenStart = new Set<number>();
  for (const delta of candidateDeltas) {
    const shifted = buildShiftedSearch(searchLines, delta);
    if (shifted === null) continue;
    const exact = findExactMatches(content, shifted, lineStarts);
    for (const m of exact) {
      if (!seenStart.has(m.startIndex)) {
        seenStart.add(m.startIndex);
        results.push({ ...m, mode: 'indentation' });
      }
    }
  }
  return results;
}

function runPasses(
  content: string,
  search: string,
  passes: MatchMode[],
  predicate?: (match: TextMatch) => boolean,
): MatchSearchResult {
  const attempts: MatchAttempt[] = [];
  const lineStarts = computeLineStarts(content);
  for (const mode of passes) {
    let ms: TextMatch[] = [];
    switch (mode) {
      case 'exact':
        ms = findExactMatches(content, search, lineStarts);
        break;
      case 'line_endings':
        ms = findNormalizedMatches(content, search, buildLineEndingsNormalized, 'line_endings');
        break;
      case 'trailing_whitespace':
        ms = findNormalizedMatches(content, search, buildTrailingWsNormalized, 'trailing_whitespace');
        break;
      case 'indentation':
        ms = findIndentationMatches(content, search);
        break;
      default:
        break;
    }
    if (predicate) ms = ms.filter(predicate);
    attempts.push({ mode, count: ms.length });
    if (ms.length === 1) return { matches: ms, attempts, usedMode: mode, ambiguous: false };
    if (ms.length > 1) return { matches: ms, attempts, usedMode: mode, ambiguous: true };
  }
  return { matches: [], attempts, ambiguous: false };
}

function findMatchesWhere(
  content: string,
  oldString: string,
  predicate: (match: TextMatch) => boolean,
): MatchSearchResult {
  return runPasses(content, oldString, ORDERED_PASSES, predicate);
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParseOk {
  ok: true;
  operations: ParsedOperation[];
}
interface ParseErr {
  ok: false;
  line?: number;
  message: string;
}

function parseError(message: string, line?: number): ParseErr {
  return { ok: false, message, line };
}

/**
 * Parse a V4A-style context patch into ordered operations.
 *
 * Envelope line endings are normalized; code line contents are preserved
 * verbatim (with exactly one control character stripped per body line).
 */
function parsePatch(patch: string): ParseOk | ParseErr {
  const lines = patch.split(/\r?\n/);

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length || lines[i] !== BEGIN) {
    return parseError('Patch must begin with *** Begin Patch.');
  }
  i++;

  const operations: ParsedOperation[] = [];
  const seenPaths = new Set<string>();
  let current: ParsedOperation | null = null;
  let currentChunk: UpdateChunk | null = null;
  let endFound = false;

  const claimPath = (path: string, lineNum: number): ParseErr | null => {
    if (seenPaths.has(path)) {
      return parseError(`Duplicate operation on path: ${path}`, lineNum);
    }
    seenPaths.add(path);
    return null;
  };

  const requirePath = (
    line: string,
    marker: string,
    lineNum: number,
  ): string | ParseErr => {
    const path = line.slice(marker.length);
    if (path.length === 0) {
      return parseError(`Missing path after "${marker.trim()}".`, lineNum);
    }
    return path;
  };

  while (i < lines.length) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line === END) {
      endFound = true;
      break;
    }

    if (line === BEGIN) {
      return parseError('Unexpected *** Begin Patch marker.', lineNum);
    }

    if (line === M_EOF) {
      if (!currentChunk) {
        return parseError('*** End of File appeared outside a chunk.', lineNum);
      }
      if (currentChunk.isEndOfFile) {
        return parseError('Duplicate *** End of File in one chunk.', lineNum);
      }
      currentChunk.isEndOfFile = true;
      currentChunk = null;
      i++;
      continue;
    }

    if (line.startsWith(M_UPDATE)) {
      const pathOrErr = requirePath(line, M_UPDATE, lineNum);
      if (typeof pathOrErr !== 'string') return pathOrErr;
      const dup = claimPath(pathOrErr, lineNum);
      if (dup) return dup;
      current = {
        type: 'update',
        path: pathOrErr,
        chunks: [],
        addLines: [],
        sourceLine: lineNum,
      };
      operations.push(current);
      currentChunk = null;
      i++;
      continue;
    }

    if (line.startsWith(M_ADD)) {
      const pathOrErr = requirePath(line, M_ADD, lineNum);
      if (typeof pathOrErr !== 'string') return pathOrErr;
      const dup = claimPath(pathOrErr, lineNum);
      if (dup) return dup;
      current = {
        type: 'add',
        path: pathOrErr,
        chunks: [],
        addLines: [],
        sourceLine: lineNum,
      };
      operations.push(current);
      currentChunk = null;
      i++;
      continue;
    }

    if (line.startsWith(M_DELETE)) {
      const pathOrErr = requirePath(line, M_DELETE, lineNum);
      if (typeof pathOrErr !== 'string') return pathOrErr;
      const dup = claimPath(pathOrErr, lineNum);
      if (dup) return dup;
      current = {
        type: 'delete',
        path: pathOrErr,
        chunks: [],
        addLines: [],
        sourceLine: lineNum,
      };
      operations.push(current);
      currentChunk = null;
      i++;
      continue;
    }

    if (line.startsWith(M_MOVE)) {
      if (
        !current ||
        current.type !== 'update' ||
        current.chunks.length > 0 ||
        current.moveTo
      ) {
        return parseError(
          '*** Move to must immediately follow an Update File header.',
          lineNum,
        );
      }
      const pathOrErr = requirePath(line, M_MOVE, lineNum);
      if (typeof pathOrErr !== 'string') return pathOrErr;
      const dup = claimPath(pathOrErr, lineNum);
      if (dup) return dup;
      current.moveTo = pathOrErr;
      i++;
      continue;
    }

    if (line.startsWith('*** ')) {
      return parseError(`Unknown patch marker: ${line}`, lineNum);
    }

    // Body line handling
    if (!current) {
      if (line.trim() === '') {
        i++;
        continue;
      }
      return parseError(
        `Unexpected line outside a file operation: ${line}`,
        lineNum,
      );
    }

    if (current.type === 'add') {
      if (line.startsWith('+')) {
        current.addLines.push(line.slice(1));
        i++;
        continue;
      }
      if (line.trim() === '') {
        i++;
        continue;
      }
      return parseError(
        'An Add File operation may only contain "+" lines.',
        lineNum,
      );
    }

    if (current.type === 'delete') {
      if (line.trim() === '') {
        i++;
        continue;
      }
      return parseError(
        'A Delete File operation must not contain body lines.',
        lineNum,
      );
    }

    // update operation
    if (line.startsWith('@@')) {
      let context: string | undefined;
      if (line === '@@') {
        context = undefined;
      } else if (/^@@\s+-\d/.test(line)) {
        return parseError('Unified diff hunk headers are not supported.', lineNum);
      } else if (line.startsWith('@@ ')) {
        context = line.slice(3);
        if (context === '') context = undefined;
      } else {
        return parseError(`Malformed chunk header: ${line}`, lineNum);
      }
      currentChunk = {
        context,
        oldLines: [],
        newLines: [],
        isEndOfFile: false,
      };
      current.chunks.push(currentChunk);
      i++;
      continue;
    }

    if (!currentChunk) {
      if (line.trim() === '') {
        i++;
        continue;
      }
      return parseError(
        'An Update chunk must start with "@@" before body lines.',
        lineNum,
      );
    }

    if (line.startsWith(' ')) {
      const content = line.slice(1);
      currentChunk.oldLines.push(content);
      currentChunk.newLines.push(content);
    } else if (line.startsWith('+')) {
      currentChunk.newLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      currentChunk.oldLines.push(line.slice(1));
    } else {
      return parseError(
        `Malformed chunk line (must start with " ", "+", or "-"): ${line}`,
        lineNum,
      );
    }
    i++;
  }

  if (!endFound) {
    return parseError('Patch must end with *** End Patch.');
  }
  for (let trailing = i + 1; trailing < lines.length; trailing++) {
    if (lines[trailing].trim() !== '') {
      return parseError('Unexpected content after *** End Patch.', trailing + 1);
    }
  }

  return { ok: true, operations };
}

// ---------------------------------------------------------------------------
// Chunk matching (ordered, fail-closed, region-constrained)
// ---------------------------------------------------------------------------

interface ChunkMatchResult {
  ok: true;
  tuple: ReplacementTuple;
}
interface ChunkMatchFail {
  ok: false;
  code: 'NO_MATCH' | 'AMBIGUOUS_MATCH' | 'AMBIGUOUS_INSERTION';
  candidateLines?: number[];
}

interface ContextAnchor {
  start: number;
  end: number;
  line: number;
}

function findContextAnchors(
  content: string,
  lineStarts: number[],
  contextText: string,
  fromOffset: number,
): ContextAnchor[] {
  const anchors: ContextAnchor[] = [];
  for (let li = 0; li < lineStarts.length; li++) {
    const start = lineStarts[li];
    if (start < fromOffset) continue;
    const end = li + 1 < lineStarts.length ? lineStarts[li + 1] : content.length;
    let bodyEnd = end;
    if (bodyEnd > start && content[bodyEnd - 1] === '\n') bodyEnd--;
    if (bodyEnd > start && content[bodyEnd - 1] === '\r') bodyEnd--;
    const body = content.slice(start, bodyEnd);
    if (body.includes(contextText)) {
      anchors.push({ start, end, line: li + 1 });
    }
  }
  return anchors;
}

function findBlankLineMatches(
  content: string,
  regionStart: number,
  chunkIndex: number,
  lineStarts: number[],
): ChunkMatchResult | ChunkMatchFail {
  const candidates: ReplacementTuple[] = [];
  for (let li = 0; li + 1 < lineStarts.length; li++) {
    const start = lineStarts[li];
    const end = lineStarts[li + 1];
    if (start < regionStart) continue;
    let bodyEnd = end - 1;
    if (bodyEnd > start && content[bodyEnd - 1] === '\r') bodyEnd--;
    if (bodyEnd === start) {
      candidates.push({
        start,
        end,
        replacement: '',
        mode: 'exact',
        startLine: li + 1,
        chunkIndex,
      });
    }
  }
  if (candidates.length === 1) return { ok: true, tuple: candidates[0] };
  if (candidates.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_MATCH',
      candidateLines: candidates.map(candidate => candidate.startLine),
    };
  }
  return { ok: false, code: 'NO_MATCH' };
}

function matchChunkOldLines(
  content: string,
  oldLinesStr: string,
  oldLineCount: number,
  regionStart: number,
  chunkIndex: number,
  lineStarts: number[],
): ChunkMatchResult | ChunkMatchFail {
  if (oldLineCount === 0) {
    return { ok: false, code: 'AMBIGUOUS_INSERTION' };
  }
  if (oldLinesStr.length === 0) {
    return findBlankLineMatches(content, regionStart, chunkIndex, lineStarts);
  }

  const suffix = content.slice(regionStart);
  const { matches, ambiguous } = findMatchesWhere(
    suffix,
    oldLinesStr,
    match => {
      const startsAtLineBoundary = match.startIndex === 0 || suffix[match.startIndex - 1] === '\n';
      let boundaryIndex = match.endIndex;
      if (match.mode === 'trailing_whitespace') {
        while (suffix[boundaryIndex] === ' ' || suffix[boundaryIndex] === '\t') boundaryIndex++;
      }
      const endsAtLineBoundary =
        oldLinesStr.endsWith('\n') ||
        boundaryIndex === suffix.length ||
        suffix[boundaryIndex] === '\r' ||
        suffix[boundaryIndex] === '\n';
      return startsAtLineBoundary && endsAtLineBoundary;
    },
  );
  if (matches.length === 1 && !ambiguous) {
    const match = matches[0];
    const start = regionStart + match.startIndex;
    let suffixEnd = match.endIndex;
    if (match.mode === 'trailing_whitespace') {
      while (suffix[suffixEnd] === ' ' || suffix[suffixEnd] === '\t') suffixEnd++;
    }
    const end = regionStart + suffixEnd;
    return {
      ok: true,
      tuple: {
        start,
        end,
        replacement: '',
        mode: match.mode,
        startLine: lineForOffset(lineStarts, start),
        chunkIndex,
      },
    };
  }
  if (matches.length > 1 || ambiguous) {
    return {
      ok: false,
      code: 'AMBIGUOUS_MATCH',
      candidateLines: matches.map(match =>
        lineForOffset(lineStarts, regionStart + match.startIndex)),
    };
  }
  return { ok: false, code: 'NO_MATCH' };
}

// ---------------------------------------------------------------------------
// Compute resulting content for an update operation
// ---------------------------------------------------------------------------

interface ComputeResult {
  ok: boolean;
  computed?: ComputedFile;
  code?: PatchFailureCode;
  chunkIndex?: number;
  candidateLines?: number[];
}

function computeUpdate(
  op: ParsedOperation,
  sourcePath: string,
  destPath: string,
  originalContent: string,
  isMove: boolean,
): ComputeResult {
  const dominant = dominantLineEnding(originalContent);
  const lineStarts = computeLineStarts(originalContent);
  const tuples: ReplacementTuple[] = [];
  let cursor = 0;

  for (let ci = 0; ci < op.chunks.length; ci++) {
    const chunk = op.chunks[ci];
    const oldLinesStr = chunk.oldLines.join('\n');
    const newLinesStr = chunk.newLines.join(dominant);

    const isPureInsertion = chunk.oldLines.length === 0;

    // --- Determine the search region via context anchor ---
    let regionStart = cursor;
    let anchorEnd = -1; // insertion point for pure-insertion-after-anchor

    if (chunk.context !== undefined) {
      const anchors = findContextAnchors(
        originalContent,
        lineStarts,
        chunk.context,
        cursor,
      );
      if (anchors.length === 0) {
        return {
          ok: false,
          code: 'NO_MATCH',
          chunkIndex: ci,
        };
      }
      if (anchors.length > 1) {
        return {
          ok: false,
          code: 'AMBIGUOUS_MATCH',
          chunkIndex: ci,
          candidateLines: anchors.map(anchor => anchor.line),
        };
      }
      anchorEnd = anchors[0].end;
      regionStart = anchorEnd;
    }

    if (isPureInsertion) {
      // Must have anchor or EOF marker.
      if (chunk.isEndOfFile) {
        // Insert at end of file.
        const insertAt = originalContent.length;
        let prefix = '';
        if (originalContent.length > 0 && !endsWithNewline(originalContent)) {
          prefix = dominant;
        }
        const insertion = prefix + newLinesStr + (newLinesStr.length > 0 ? dominant : '');
        const tuple: ReplacementTuple = {
          start: insertAt,
          end: insertAt,
          replacement: insertion,
          mode: 'exact',
          startLine: lineForOffset(lineStarts, insertAt),
          chunkIndex: ci,
        };
        tuples.push(tuple);
        cursor = insertAt;
        continue;
      }

      if (chunk.context !== undefined) {
        // Insert immediately after the unique anchor line.
        const prefix = anchorEnd > 0 && originalContent[anchorEnd - 1] !== '\n'
          ? dominant
          : '';
        const insertion = prefix + newLinesStr + (newLinesStr.length > 0 ? dominant : '');
        const tuple: ReplacementTuple = {
          start: anchorEnd,
          end: anchorEnd,
          replacement: insertion,
          mode: 'exact',
          startLine: lineForOffset(lineStarts, anchorEnd),
          chunkIndex: ci,
        };
        tuples.push(tuple);
        cursor = anchorEnd;
        continue;
      }

      // Ambiguous pure insertion.
      return {
        ok: false,
        code: 'AMBIGUOUS_INSERTION',
        chunkIndex: ci,
      };
    }

    // --- Match oldLines within region ---
    const matchResult = matchChunkOldLines(
      originalContent,
      oldLinesStr,
      chunk.oldLines.length,
      regionStart,
      ci,
      lineStarts,
    );
    if (!matchResult.ok) {
      return {
        ok: false,
        code: matchResult.code,
        chunkIndex: ci,
        candidateLines: matchResult.candidateLines,
      };
    }

    const tuple = matchResult.tuple;
    let replaceEnd = tuple.end;

    if (chunk.isEndOfFile) {
      // Extend replacement to end of file.
      replaceEnd = originalContent.length;
    }

    let replacement = newLinesStr;
    if (oldLinesStr.length === 0 && chunk.oldLines.length > 0 && chunk.newLines.length > 0) {
      replacement += dominant;
    }
    if (chunk.isEndOfFile && endsWithNewline(originalContent) && !endsWithNewline(replacement)) {
      replacement += dominant;
    }
    tuple.replacement = replacement;
    tuple.end = replaceEnd;
    tuples.push(tuple);

    // Advance cursor beyond the matched original region.
    cursor = tuple.end;
  }

  // Apply all tuples in descending start order to preserve offsets.
  const sorted = [...tuples].sort((a, b) => b.start - a.start);
  let resultContent = originalContent;
  for (const t of sorted) {
    resultContent =
      resultContent.slice(0, t.start) + t.replacement + resultContent.slice(t.end);
  }

  return {
    ok: true,
    computed: {
      op,
      sourcePath,
      destPath,
      originalContent,
      resultContent,
      tuples,
      isMove,
    },
  };
}

// ---------------------------------------------------------------------------
// Permission analysis
// ---------------------------------------------------------------------------

interface PermissionPath {
  path: string;
  operation: 'write' | 'delete';
}

interface PathAnalysis {
  blocked: string[];
  outsideWorkspace: PermissionPath[];
  sensitive: PermissionPath[];
  deletionRisks: string[];
}

function analyzePaths(
  ctx: ToolContext,
  resolved: Array<{
    op: ParsedOperation;
    sourcePath: string;
    destPath: string;
    isMove: boolean;
    isDelete: boolean;
    displaySource: string;
    displayDest: string;
  }>,
): PathAnalysis {
  const analysis: PathAnalysis = {
    blocked: [],
    outsideWorkspace: [],
    sensitive: [],
    deletionRisks: [],
  };

  const checkPath = (
    resolvedPath: string,
    displayPath: string,
    operation: PermissionPath['operation'],
  ) => {
    if (ctx.isBlockedPath(resolvedPath)) {
      analysis.blocked.push(displayPath);
    }
    const permissionPath = { path: displayPath, operation };
    if (!ctx.isWithinWorkspace(resolvedPath)) {
      analysis.outsideWorkspace.push(permissionPath);
    }
    if (ctx.isSensitivePath(resolvedPath)) {
      analysis.sensitive.push(permissionPath);
    }
  };

  for (const entry of resolved) {
    const sourceOperation = entry.isDelete || entry.isMove ? 'delete' : 'write';
    checkPath(entry.sourcePath, entry.displaySource, sourceOperation);
    if (entry.destPath !== entry.sourcePath) {
      checkPath(entry.destPath, entry.displayDest, 'write');
    }
    if (entry.isDelete || entry.isMove) {
      analysis.deletionRisks.push(entry.sourcePath);
    }
  }

  const dedupStrings = (values: string[]): string[] => [...new Set(values)];
  const dedupPaths = (values: PermissionPath[]): PermissionPath[] => {
    const seen = new Set<string>();
    return values.filter(value => {
      const key = `${value.operation}:${value.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  analysis.blocked = dedupStrings(analysis.blocked);
  analysis.outsideWorkspace = dedupPaths(analysis.outsideWorkspace);
  analysis.sensitive = dedupPaths(analysis.sensitive);
  analysis.deletionRisks = dedupStrings(analysis.deletionRisks);

  return analysis;
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

type JournalEntry =
  | { existed: false }
  | { existed: true; content: string };

interface AppliedRecord {
  kind: 'write' | 'rm';
  path: string;
}

async function rollback(
  ctx: ToolContext,
  journal: Map<string, JournalEntry>,
  applied: AppliedRecord[],
): Promise<string[]> {
  const errors: string[] = [];
  // Reverse the applied operations.
  for (let idx = applied.length - 1; idx >= 0; idx--) {
    const rec = applied[idx];
    const entry = journal.get(rec.path);
    try {
      if (rec.kind === 'write') {
        if (entry?.existed) {
          await ctx.fs.writeFile(rec.path, entry.content);
        } else {
          await ctx.fs.rm(rec.path);
        }
      } else if (entry?.existed) {
        await ctx.fs.writeFile(rec.path, entry.content);
      }
    } catch (err: unknown) {
      errors.push(`Rollback failed for ${rec.path}: ${errMsg(err)}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Diff visualization
// ---------------------------------------------------------------------------

function buildModificationDiff(
  cf: ComputedFile,
): { path: string; hunks: DiffHunk[]; additions: number; deletions: number } {
  const oldContent = cf.originalContent ?? '';
  const oldLines = oldContent.split('\n').map(stripCR);
  const lineStarts = computeLineStarts(oldContent);

  const sortedTuples = [...cf.tuples].sort((a, b) => a.start - b.start);

  const hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  let previousEndLine = 0;

  for (const tuple of sortedTuples) {
    const startLine = lineForOffset(lineStarts, tuple.start);
    const endLine =
      tuple.end > tuple.start
        ? lineForOffset(lineStarts, tuple.end - 1)
        : startLine;

    const ctxBeforeStart = Math.max(previousEndLine + 1, startLine - DIFF_CONTEXT);

    const changes: DiffChange[] = [];
    let oldLineNum = ctxBeforeStart;
    let newLineNum = ctxBeforeStart;

    // Context before
    for (let L = ctxBeforeStart; L < startLine; L++) {
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
    for (let L = startLine; L <= endLine; L++) {
      changes.push({
        type: 'removed',
        content: oldLines[L - 1] ?? '',
        oldLineNumber: oldLineNum,
      });
      oldLineNum++;
      deletions++;
    }

    // Added lines
    const addedTexts = tuple.replacement.length > 0
      ? tuple.replacement.split('\n').map(stripCR)
      : [];
    for (const text of addedTexts) {
      changes.push({
        type: 'added',
        content: text,
        newLineNumber: newLineNum,
      });
      newLineNum++;
      additions++;
    }

    hunks.push({
      oldStart: ctxBeforeStart,
      oldLines: oldLineNum - ctxBeforeStart,
      newStart: ctxBeforeStart,
      newLines: newLineNum - ctxBeforeStart,
      changes,
    });
    previousEndLine = endLine;
  }

  return { path: cf.destPath, hunks, additions, deletions };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (typeof input.patch !== 'string' || input.patch.length === 0) {
      return failure('INVALID_INPUT', 'Patch must be a non-empty string.');
    }

    // --- Parse ---
    const parsed = parsePatch(input.patch);
    if (!parsed.ok) {
      return failure(
        'PARSE_ERROR',
        parsed.line
          ? `Parse error at line ${parsed.line}: ${parsed.message}`
          : `Parse error: ${parsed.message}`,
        { line: parsed.line, message: parsed.message },
      );
    }

    const operations = parsed.operations;
    if (operations.length === 0) {
      return failure('INVALID_INPUT', 'Patch contains no file operations.');
    }

    // Validate update operations and chunks before resolving paths.
    for (const op of operations) {
      if (op.type === 'update' && op.chunks.length === 0) {
        return failure(
          'PARSE_ERROR',
          `Update File operation on "${op.path}" contains no chunks.`,
          { path: op.path, line: op.sourceLine },
        );
      }
      if (op.type === 'update' && op.chunks.some(chunk =>
        chunk.oldLines.length === 0 && chunk.newLines.length === 0)) {
        return failure(
          'PARSE_ERROR',
          `Update File operation on "${op.path}" contains an empty chunk.`,
          { path: op.path, line: op.sourceLine },
        );
      }
    }

    // --- Resolve all paths ---
    const resolved = operations.map((op) => {
      const displaySource = op.path;
      const displayDest = op.moveTo ?? op.path;
      return {
        op,
        sourcePath: ctx.resolvePath(op.path),
        destPath: ctx.resolvePath(op.moveTo ?? op.path),
        isMove: !!op.moveTo,
        isDelete: op.type === 'delete',
        displaySource,
        displayDest,
      };
    });

    const selfMove = resolved.find(entry => entry.isMove && entry.sourcePath === entry.destPath);
    if (selfMove) {
      return failure(
        'INVALID_INPUT',
        `Move destination resolves to the source path: ${selfMove.displaySource}`,
        { path: selfMove.displaySource },
      );
    }

    // --- Permission analysis ---
    const analysis = analyzePaths(ctx, resolved);

    if (analysis.blocked.length > 0) {
      return failure(
        'BLOCKED_PATH',
        `Cannot apply patch to system directories: ${analysis.blocked.join(', ')}`,
        { message: analysis.blocked.join(', ') },
      );
    }

    for (const target of analysis.outsideWorkspace) {
      const request = target.operation === 'delete'
        ? {
            type: 'permission' as const,
            question: `Deleting an outside-workspace file requires approval: ${target.path}`,
            risk: 'medium' as const,
            resource: 'file' as const,
            action: 'delete' as const,
            paths: [target.path],
            patterns: [`file:${target.path}`],
            duration: 'session' as const,
          }
        : createFilePermissionAsk({
            path: target.path,
            operation: 'write',
            risk: 'medium',
            isOutsideWorkspace: true,
          });
      const approved = await ctx.ask(request);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    for (const target of analysis.sensitive) {
      const request = target.operation === 'delete'
        ? {
            type: 'permission' as const,
            question: `Deleting a sensitive file requires approval: ${target.path}`,
            risk: 'medium' as const,
            resource: 'file' as const,
            action: 'delete' as const,
            paths: [target.path],
            patterns: [`file:${target.path}`],
            duration: 'session' as const,
          }
        : createFilePermissionAsk({
            path: target.path,
            operation: 'write',
            risk: 'medium',
            isSensitiveFile: true,
            reason: 'This file may contain credentials or secrets.',
          });
      const approved = await ctx.ask(request);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    if (analysis.deletionRisks.length > 0) {
      const approved = await ctx.ask({
        type: 'permission',
        question: `Applying a patch that deletes or moves files requires approval: ${analysis.deletionRisks.join(', ')}`,
        risk: 'medium',
        resource: 'file',
        action: 'delete',
        paths: analysis.deletionRisks,
        patterns: analysis.deletionRisks.map((p) => `file:${p}`),
        duration: 'session',
      });
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    // --- Precompute: read, match, compute every result in memory ---
    const journal = new Map<string, JournalEntry>();
    const computedFiles: ComputedFile[] = [];

    const recordJournal = async (path: string): Promise<void> => {
      if (journal.has(path)) return;
      const exists = await ctx.fs.exists(path);
      if (!exists) {
        journal.set(path, { existed: false });
        return;
      }
      const content = await ctx.fs.readFile(path, 'utf-8');
      journal.set(path, { existed: true, content });
    };

    for (const entry of resolved) {
      const { op, sourcePath, destPath, isMove } = entry;

      if (op.type === 'add') {
        if (await ctx.fs.exists(destPath)) {
          return failure(
            'DEST_EXISTS',
            `Cannot create file that already exists: ${entry.displayDest}`,
            { path: entry.displayDest },
          );
        }
        journal.set(destPath, { existed: false });
        const content =
          op.addLines.length > 0 ? op.addLines.join('\n') + '\n' : '';
        computedFiles.push({
          op,
          sourcePath: destPath,
          destPath,
          originalContent: null,
          resultContent: content,
          tuples: [],
          isMove: false,
        });
        continue;
      }

      if (op.type === 'delete') {
        if (!await ctx.fs.exists(sourcePath)) {
          return failure(
            'FILE_NOT_FOUND',
            `Cannot delete a file that does not exist: ${entry.displaySource}`,
            { path: entry.displaySource },
          );
        }
        try {
          const stat = await ctx.fs.stat(sourcePath);
          if (stat.isDirectory) {
            return failure(
              'INVALID_INPUT',
              `Cannot delete a directory: ${entry.displaySource}`,
              { path: entry.displaySource },
            );
          }
        } catch (err: unknown) {
          return failure(
            'FILE_NOT_FOUND',
            `Cannot stat file for deletion: ${errMsg(err)}`,
            { path: entry.displaySource },
          );
        }
        await recordJournal(sourcePath);
        const jSrc = journal.get(sourcePath)!;
        if (!jSrc.existed) {
          return failure('FILE_NOT_FOUND', `File not found: ${entry.displaySource}`);
        }
        computedFiles.push({
          op,
          sourcePath,
          destPath: sourcePath,
          originalContent: jSrc.content,
          resultContent: '',
          tuples: [],
          isMove: false,
        });
        continue;
      }

      // update
      if (!await ctx.fs.exists(sourcePath)) {
        return failure(
          'FILE_NOT_FOUND',
          `File not found: ${entry.displaySource}`,
          { path: entry.displaySource },
        );
      }

      try {
        const stat = await ctx.fs.stat(sourcePath);
        if (stat.isDirectory) {
          return failure(
            'INVALID_INPUT',
            `Cannot update a directory: ${entry.displaySource}`,
            { path: entry.displaySource },
          );
        }
      } catch (err: unknown) {
        return failure(
          'FILE_NOT_FOUND',
          `Cannot stat file for update: ${errMsg(err)}`,
          { path: entry.displaySource },
        );
      }

      await recordJournal(sourcePath);
      const jSrc = journal.get(sourcePath)!;
      if (!jSrc.existed) {
        return failure('FILE_NOT_FOUND', `File not found: ${entry.displaySource}`);
      }

      if (isMove) {
        if (await ctx.fs.exists(destPath)) {
          return failure(
            'DEST_EXISTS',
            `Cannot move to a file that already exists: ${entry.displayDest}`,
            { path: entry.displayDest },
          );
        }
        journal.set(destPath, { existed: false });
      }

      const result = computeUpdate(
        op,
        sourcePath,
        destPath,
        jSrc.content,
        isMove,
      );
      if (!result.ok) {
        const code = result.code ?? 'NO_MATCH';
        const pathLabel = entry.displaySource;
        if (code === 'AMBIGUOUS_INSERTION') {
          return failure(
            'AMBIGUOUS_INSERTION',
            `Ambiguous pure insertion in chunk ${result.chunkIndex} of ${pathLabel}. Add a context anchor or *** End of File.`,
            {
              path: pathLabel,
              chunkIndex: result.chunkIndex,
            },
          );
        }
        if (code === 'AMBIGUOUS_MATCH') {
          return failure(
            'AMBIGUOUS_MATCH',
            `Found multiple matches for chunk ${result.chunkIndex} of ${pathLabel}.`,
            {
              path: pathLabel,
              chunkIndex: result.chunkIndex,
              candidateLines: result.candidateLines,
            },
          );
        }
        return failure(
          'NO_MATCH',
          `No match for chunk ${result.chunkIndex} of ${pathLabel}. Re-read the file before retrying.`,
          {
            path: pathLabel,
            chunkIndex: result.chunkIndex,
          },
        );
      }

      computedFiles.push(result.computed!);
    }

    // --- Apply in deterministic order: writes first, then removals ---
    const applied: AppliedRecord[] = [];
    const writeOps = computedFiles.filter(
      (cf) => cf.op.type === 'add' || cf.op.type === 'update',
    );
    const removeOps = computedFiles.filter(
      (cf) => cf.op.type === 'delete' || cf.isMove,
    );

    // Writes: modifications, additions, and move destinations.
    for (const cf of writeOps) {
      try {
        await ctx.fs.writeFile(cf.destPath, cf.resultContent);
        applied.push({ kind: 'write', path: cf.destPath });
      } catch (err: unknown) {
        const rollbackErrors = await rollback(ctx, journal, applied);
        return failure(
          'APPLY_ERROR',
          `Failed to write ${cf.destPath}: ${errMsg(err)}`,
          {
            path: cf.destPath,
            message: errMsg(err),
            rollbackErrors: rollbackErrors.length > 0 ? rollbackErrors : undefined,
          },
        );
      }
    }

    // Removals: deletions and move sources.
    for (const cf of removeOps) {
      const rmPath = cf.op.type === 'delete' ? cf.sourcePath : cf.sourcePath;
      try {
        await ctx.fs.rm(rmPath);
        applied.push({ kind: 'rm', path: rmPath });
      } catch (err: unknown) {
        const rollbackErrors = await rollback(ctx, journal, applied);
        return failure(
          'APPLY_ERROR',
          `Failed to remove ${rmPath}: ${errMsg(err)}`,
          {
            path: rmPath,
            message: errMsg(err),
            rollbackErrors: rollbackErrors.length > 0 ? rollbackErrors : undefined,
          },
        );
      }
    }

    // --- Build result ---
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const moved: Array<{ from: string; to: string }> = [];
    const matchModes: ApplyPatchResult['matchModes'] = [];
    const diffs: ApplyPatchResult['diffs'] = [];

    for (const cf of computedFiles) {
      if (cf.op.type === 'add') {
        added.push(cf.destPath);
      } else if (cf.op.type === 'delete') {
        deleted.push(cf.sourcePath);
      } else if (cf.isMove) {
        moved.push({ from: cf.sourcePath, to: cf.destPath });
        modified.push(cf.destPath);
      } else {
        modified.push(cf.destPath);
      }

      if (cf.op.type === 'update') {
        for (const t of cf.tuples) {
          matchModes.push({
            path: cf.destPath,
            chunkIndex: t.chunkIndex,
            mode: t.mode,
            startLine: t.startLine,
          });
        }
        diffs.push(buildModificationDiff(cf));
      }
    }

    const result: ApplyPatchResult = {
      added,
      modified,
      deleted,
      moved,
      matchModes,
      diffs,
    };

    // --- Visualization: file-list summary ---
    const groups: FileListVisualization['groups'] = [];
    if (modified.length > 0) {
      groups.push({
        label: 'Modified',
        icon: 'edit',
        files: modified.map((p) => ({ path: p, action: 'modified' as const })),
      });
    }
    if (added.length > 0) {
      groups.push({
        label: 'Created',
        icon: 'plus',
        files: added.map((p) => ({ path: p, action: 'created' as const })),
      });
    }
    if (deleted.length > 0) {
      groups.push({
        label: 'Deleted',
        icon: 'trash',
        files: deleted.map((p) => ({ path: p, action: 'deleted' as const })),
      });
    }
    if (moved.length > 0) {
      groups.push({
        label: 'Moved',
        icon: 'edit',
        files: moved.map((m) => ({ path: `${m.from} -> ${m.to}` })),
      });
    }

    const total = added.length + modified.length + deleted.length + moved.length;
    const visualization: FileListVisualization = {
      type: 'file-list',
      title: `Applied patch to ${total} file${total !== 1 ? 's' : ''}`,
      groups,
      total,
    };

    return { success: true, result, visualization };
  } catch (err: unknown) {
    const message = errMsg(err);
    return failure('APPLY_ERROR', message, { message });
  }
}
