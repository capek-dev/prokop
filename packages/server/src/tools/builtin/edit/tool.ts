import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { DiffVisualization } from '@prokopai/sdk';
import { createFilePermissionAsk } from '@prokopai/sdk';

// ---------------------------------------------------------------------------
// Local safe matching engine
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

type Strategy = 'exact' | 'line_start' | 'line_end' | 'partial' | 'multi_line';

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

// ---------------------------------------------------------------------------
// Offset helpers
// ---------------------------------------------------------------------------

function buildLineStarts(content: string): number[] {
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

// ---------------------------------------------------------------------------
// Line splitting (preserves terminators and offsets)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pass: exact (full-content substring, supports multi-line)
// ---------------------------------------------------------------------------

function findExactMatches(content: string, search: string, lineStarts: number[]): TextMatch[] {
  const matches: TextMatch[] = [];
  if (search.length === 0) return matches;
  let cursor = 0;
  const requiresLineStart = search.includes('\n') && /^[ \t]/.test(search);
  while (cursor <= content.length - search.length) {
    const idx = content.indexOf(search, cursor);
    if (idx === -1) break;
    if (!requiresLineStart || idx === 0 || content[idx - 1] === '\n' || content[idx - 1] === '\r') {
      matches.push(toTextMatch(lineStarts, idx, idx + search.length, 'exact'));
    }
    cursor = idx + search.length;
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Normalized text builders with original offset mapping
// ---------------------------------------------------------------------------

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
  const lineStarts = buildLineStarts(content);
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

// ---------------------------------------------------------------------------
// Pass: indentation (one consistent delta across nonblank lines)
// ---------------------------------------------------------------------------

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
  const lineStarts = buildLineStarts(content);
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

// ---------------------------------------------------------------------------
// Compatibility passes: line_start / line_end (single-line, correct offsets)
// ---------------------------------------------------------------------------

function findLineStartMatches(content: string, search: string): TextMatch[] {
  const matches: TextMatch[] = [];
  if (search.length === 0 || search.includes('\n')) return matches;
  const lineStarts = buildLineStarts(content);
  for (const cl of buildContentLines(content)) {
    if (cl.text.startsWith(search)) {
      matches.push(toTextMatch(lineStarts, cl.start, cl.start + search.length, 'line_start'));
    }
  }
  return matches;
}

function findLineEndMatches(content: string, search: string): TextMatch[] {
  const matches: TextMatch[] = [];
  if (search.length === 0 || search.includes('\n')) return matches;
  const lineStarts = buildLineStarts(content);
  for (const cl of buildContentLines(content)) {
    if (search.length <= cl.text.length && cl.text.endsWith(search)) {
      matches.push(toTextMatch(lineStarts, cl.textEnd - search.length, cl.textEnd, 'line_end'));
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function resolve(
  matches: TextMatch[],
  attempts: MatchAttempt[],
  mode: MatchMode,
): MatchSearchResult {
  if (matches.length === 1) return { matches, attempts, usedMode: mode, ambiguous: false };
  if (matches.length > 1) return { matches, attempts, usedMode: mode, ambiguous: true };
  return { matches: [], attempts, ambiguous: false };
}

function runPasses(
  content: string,
  search: string,
  passes: MatchMode[],
  predicate?: (match: TextMatch) => boolean,
): MatchSearchResult {
  const attempts: MatchAttempt[] = [];
  const lineStarts = buildLineStarts(content);
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
    const requiresLineStart = search.includes('\n') && /^[ \t]/.test(search);
    if (requiresLineStart) {
      ms = ms.filter(match =>
        match.startIndex === 0 ||
        content[match.startIndex - 1] === '\n' ||
        content[match.startIndex - 1] === '\r');
    }
    if (predicate) ms = ms.filter(predicate);
    attempts.push({ mode, count: ms.length });
    if (ms.length === 1) return { matches: ms, attempts, usedMode: mode, ambiguous: false };
    if (ms.length > 1) return { matches: ms, attempts, usedMode: mode, ambiguous: true };
  }
  return { matches: [], attempts, ambiguous: false };
}

const ORDERED_PASSES: MatchMode[] = [
  'exact',
  'line_endings',
  'trailing_whitespace',
  'indentation',
];

/**
 * Find matches for `oldString` in `content`.
 *
 * - `strategy` omitted: run the safe ordered passes.
 * - `'exact'`: strict full-content exact match only.
 * - `'line_start'` / `'line_end'`: compatibility single-line anchored matches.
 * - `'partial'` / `'multi_line'`: compatibility, mapped to the safe ordered passes.
 */
function findMatches(
  content: string,
  oldString: string,
  strategy?: Strategy,
): MatchSearchResult {
  if (strategy === 'line_start') {
    const ms = findLineStartMatches(content, oldString);
    return resolve(ms, [{ mode: 'line_start', count: ms.length }], 'line_start');
  }
  if (strategy === 'line_end') {
    const ms = findLineEndMatches(content, oldString);
    return resolve(ms, [{ mode: 'line_end', count: ms.length }], 'line_end');
  }

  const passes =
    strategy === 'exact' ? (['exact'] as MatchMode[]) : ORDERED_PASSES;
  return runPasses(content, oldString, passes);
}

/** Count exact full-content occurrences of `needle`. Used for diagnostics only. */
function countExactOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  return findExactMatches(content, needle, buildLineStarts(content)).length;
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

/**
 * Adapt the replacement text's line endings to the original file when a match
 * was located by a line-ending normalization pass and the replacement already
 * uses LF. This keeps unrelated bytes byte-for-byte equivalent except for the
 * matched span, while normalizing the introduced line breaks to the file style.
 */
function adaptReplacement(
  replacement: string,
  mode: MatchMode | undefined,
  originalContent: string,
): string {
  if (mode !== 'line_endings' && mode !== 'trailing_whitespace') return replacement;
  if (!replacement.includes('\n')) return replacement;
  const dominant = dominantLineEnding(originalContent);
  if (dominant === '\n') return replacement;
  return replacement.replace(/\r?\n/g, dominant);
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

type EditFailureCode =
  | 'INVALID_INPUT'
  | 'FILE_NOT_FOUND'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH';

interface EditFailureResult {
  code: EditFailureCode;
  path: string;
  attempts?: MatchAttempt[];
  candidateLines?: number[];
  newStringExactMatchCount?: number;
}

interface Input {
  path: string;
  oldString: string;
  newString: string;
  strategy?: Strategy;
}

interface MatchInfo {
  mode: string;
  lineNumber: number;
}

const KNOWN_STRATEGIES = new Set<Strategy>([
  'exact',
  'line_start',
  'line_end',
  'partial',
  'multi_line',
]);

const MODE_LABEL: Record<string, string> = {
  exact: 'exact',
  line_endings: 'line-ending',
  trailing_whitespace: 'trailing-whitespace',
  indentation: 'indentation',
  line_start: 'line-start',
  line_end: 'line-end',
};

function failure(code: EditFailureCode, path: string, error: string, extra?: Partial<EditFailureResult>): ToolResult {
  return { success: false, error, result: { code, path, ...extra } satisfies EditFailureResult };
}

export const definition: ToolDefinition = {
  name: 'edit',
  description: `Performs string replacements in an existing file.

## When to use

- Making targeted changes to an existing file (adding, modifying, or removing lines)
- Replacing a specific block of code, function, or text
- Applying small, surgical edits without rewriting the entire file

## When NOT to use

- Creating a new file, use write-file instead
- Replacing the entire file content, use write-file instead
- Making many edits to the same file, use multiedit for atomic batch edits
- Applying git-style patches, use apply-patch instead
- Copying existing text is unreliable, use edit-range with line numbers and a revision
- Complex or multi-file changes, use apply-patch instead

## Parameters

- path (required): Absolute path to the file to edit
- oldString (required): The text to find and replace. Must be copied VERBATIM from the file, with the same indentation, quotes, punctuation, and whitespace. Do NOT guess, approximate, or "fix" what you think the text should be. Always read the file first to get the exact content. Exact matching supports both one-line and multi-line text.
- newString (required): The replacement text. May be empty to delete the matched text.
- strategy (optional): Matching strategy. Omit it to use safe formatting-tolerant passes, or use 'exact'. The values 'line_start', 'line_end', 'partial', and 'multi_line' are compatibility strategies kept for migration and may be removed in a later release.

## Matching behavior

When strategy is omitted, the tool tries ordered passes from strictest to loosest and stops at the first pass that finds candidates:

1. exact: literal full-content substring match (supports multi-line text)
2. line-endings: treats \\\\r\\\\n and \\\\n as equivalent
3. trailing-whitespace: ignores spaces/tabs immediately before a line ending
4. indentation: allows one consistent indentation shift across all nonblank lines

An ambiguous match (more than one candidate at any pass) fails rather than selecting the first occurrence. Internal whitespace is never ignored, and whitespace inside string literals is never altered.

## Critical rules

- **Copy verbatim**: oldString must be an exact substring of the file content, matching character-for-character including all whitespace, indentation, blank lines, and surrounding code.
- **Read first**: Always read the file before editing so you have the exact content to copy.
- **Unique match**: oldString must match exactly one location. If it matches multiple locations or none, the edit fails. Make oldString specific enough to be unambiguous.
- **No regex**: oldString is a literal string, not a regular expression. Do not use regex patterns.
- **Single edit**: This tool performs one replacement per call. For multiple edits to the same file, use multiedit instead.

## Minimal example

\`\`\`
oldString: "const x = 1;"
newString: "const x = 2;"
\`\`\`

## Permission model

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
      oldString: {
        type: 'string',
        description: 'The text to find and replace',
        minLength: 1,
      },
      newString: {
        type: 'string',
        description: 'The replacement text',
      },
      strategy: {
        type: 'string',
        description: "Matching strategy: omit for safe ordered passes, or use 'exact'. 'line_start', 'line_end', 'partial', and 'multi_line' are compatibility strategies.",
        enum: ['exact', 'line_start', 'line_end', 'partial', 'multi_line'],
      },
    },
    required: ['path', 'oldString', 'newString'],
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

function summarizeAttempts(attempts: MatchAttempt[]): string {
  if (attempts.length === 0) return '';
  const parts = attempts.map(a => `${MODE_LABEL[a.mode] ?? a.mode}=${a.count}`);
  return `${parts.join(', ')}`;
}

function buildDiffVisualization(
  oldContent: string,
  matchStartLine: number,
  oldString: string,
  newString: string,
  usedMode: string,
  resolvedPath: string,
): DiffVisualization {
  const oldLines = oldContent.split('\n');
  const contextSize = 5;
  const matchIndex = matchStartLine - 1;
  const contextStart = Math.max(0, matchIndex - contextSize);

  type DiffChange = { type: 'added' | 'removed' | 'context'; content: string; oldLineNumber?: number; newLineNumber?: number };
  const changes: DiffChange[] = [];
  let oldLineNum = contextStart + 1;
  let newLineNum = contextStart + 1;

  for (let i = contextStart; i < matchIndex; i++) {
    changes.push({ type: 'context', content: oldLines[i] || '', oldLineNumber: oldLineNum, newLineNumber: newLineNum });
    oldLineNum++;
    newLineNum++;
  }

  const oldStringLines = oldString.split('\n');
  for (const line of oldStringLines) {
    changes.push({ type: 'removed', content: line, oldLineNumber: oldLineNum });
    oldLineNum++;
  }

  const newStringLines = newString.split('\n');
  for (const line of newStringLines) {
    changes.push({ type: 'added', content: line, newLineNumber: newLineNum });
    newLineNum++;
  }

  const afterStart = matchIndex + oldStringLines.length;
  const afterEnd = Math.min(oldLines.length, afterStart + contextSize);
  for (let i = afterStart; i < afterEnd; i++) {
    changes.push({ type: 'context', content: oldLines[i] || '', oldLineNumber: oldLineNum, newLineNumber: newLineNum });
    oldLineNum++;
    newLineNum++;
  }

  return {
    type: 'diff',
    path: resolvedPath,
    language: detectLanguage(resolvedPath),
    hunks: [{
      oldStart: contextStart + 1,
      oldLines: oldLineNum - contextStart - 1,
      newStart: contextStart + 1,
      newLines: newLineNum - contextStart - 1,
      changes,
    }],
    additions: newStringLines.length,
    deletions: oldStringLines.length,
    matchInfo: { strategy: usedMode, lineNumber: matchStartLine },
  };
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    // Runtime validation (callers are not guaranteed to pass through schema validation)
    if (typeof input.oldString !== 'string' || input.oldString.length === 0) {
      return failure('INVALID_INPUT', input.path, 'oldString must be a non-empty string.');
    }
    if (input.strategy !== undefined && !KNOWN_STRATEGIES.has(input.strategy)) {
      return failure('INVALID_INPUT', input.path, `Unknown strategy: ${String(input.strategy)}.`);
    }

    const resolvedPath = ctx.resolvePath(input.path);

    if (ctx.isBlockedPath(resolvedPath)) {
      return failure('FILE_NOT_FOUND', input.path, `Editing system directories is not allowed: ${input.path}`);
    }

    const outsideWorkspace = !ctx.isWithinWorkspace(resolvedPath);
    const sensitive = ctx.isSensitivePath(resolvedPath);

    if (outsideWorkspace) {
      const permAsk = createFilePermissionAsk({
        path: input.path, operation: 'edit', risk: 'medium', isOutsideWorkspace: true,
      });
      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    if (sensitive) {
      const permAsk = createFilePermissionAsk({
        path: input.path, operation: 'edit', risk: 'medium', isSensitiveFile: true,
        reason: 'This file may contain credentials or secrets.',
      });
      const approved = await ctx.ask(permAsk);
      if (!approved) return { success: false, error: 'USER_REJECTION' };
    }

    const exists = await ctx.fs.exists(resolvedPath);
    if (!exists) {
      return failure('FILE_NOT_FOUND', resolvedPath, `File not found: ${resolvedPath}`);
    }

    const content = await ctx.fs.readFile(resolvedPath, 'utf-8');

    const { matches, usedMode, attempts, ambiguous } = findMatches(content, input.oldString, input.strategy);

    if (matches.length === 0) {
      const newCount = input.newString.length > 0 ? countExactOccurrences(content, input.newString) : undefined;
      const attemptSummary = summarizeAttempts(attempts);
      const msg = `No match found.${attemptSummary ? ` Passes: ${attemptSummary}.` : ''} Re-read the file before retrying.`;
      return failure('NO_MATCH', resolvedPath, msg, { attempts, newStringExactMatchCount: newCount });
    }

    if (ambiguous || matches.length > 1) {
      const candidateLines = matches.map(m => m.startLine);
      const attemptSummary = summarizeAttempts(attempts);
      const msg = `Found ${matches.length} matches.${attemptSummary ? ` Passes: ${attemptSummary}.` : ''} Provide a more specific oldString.`;
      return failure('AMBIGUOUS_MATCH', resolvedPath, msg, { attempts, candidateLines });
    }

    const match = matches[0];
    const before = content.substring(0, match.startIndex);
    const after = content.substring(match.endIndex);
    const effectiveNewString = adaptReplacement(input.newString, match.mode, content);
    const newContent = before + effectiveNewString + after;

    await ctx.fs.writeFile(resolvedPath, newContent);

    const matchInfo: MatchInfo = { mode: usedMode ?? 'exact', lineNumber: match.startLine };

    const visualization = buildDiffVisualization(
      content, match.startLine, input.oldString, effectiveNewString, matchInfo.mode, resolvedPath,
    );

    return { success: true, result: { matchInfo }, visualization };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
