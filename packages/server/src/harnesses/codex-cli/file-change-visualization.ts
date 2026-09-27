import type { AnyVisualization, DiffVisualization } from '@prokopai/sdk';
import { codexObject } from './app-server';

const MAX_PATCH_CHARS = 8_000;
const MAX_CHANGES = 50;

function parseDiff(path: string, patch: string): DiffVisualization | null {
  const hunks: DiffVisualization['hunks'] = [];
  let additions = 0;
  let deletions = 0;
  let hunk: DiffVisualization['hunks'][number] | null = null;
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header) {
      if (hunk && (oldLine - hunk.oldStart !== hunk.oldLines || newLine - hunk.newStart !== hunk.newLines)) return null;
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      const oldLines = header[2] === undefined ? 1 : Number(header[2]);
      const newLines = header[4] === undefined ? 1 : Number(header[4]);
      if (![oldLine, newLine, oldLines, newLines].every(Number.isSafeInteger)) return null;
      hunk = { oldStart: oldLine, oldLines, newStart: newLine, newLines, changes: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      if (line.startsWith('@@')) return null;
      continue; // Optional git and file headers.
    }
    if (line.startsWith('\\ No newline at end of file')) continue;
    const content = line.slice(1);
    if (line.startsWith('+')) {
      hunk.changes.push({ type: 'added', content, newLineNumber: newLine++ });
      additions++;
    } else if (line.startsWith('-')) {
      hunk.changes.push({ type: 'removed', content, oldLineNumber: oldLine++ });
      deletions++;
    } else if (line.startsWith(' ')) {
      hunk.changes.push({ type: 'context', content, oldLineNumber: oldLine++, newLineNumber: newLine++ });
    } else return null;
    if (oldLine - hunk.oldStart > hunk.oldLines || newLine - hunk.newStart > hunk.newLines) return null;
  }
  if (!hunk || oldLine - hunk.oldStart !== hunk.oldLines || newLine - hunk.newStart !== hunk.newLines) return null;
  return { type: 'diff', path, hunks, additions, deletions };
}

/** Preserve the existing preview limit without passing incomplete patches to the diff viewer. */
export function fileChangeVisualization(raw: unknown): AnyVisualization {
  const changes = Array.isArray(raw) ? raw : [];
  const items: DiffVisualization[] = [];
  const text: string[] = [];
  let length = 0;
  let valid = changes.length > 0 && changes.length <= MAX_CHANGES;
  for (const change of changes.slice(0, MAX_CHANGES)) {
    const row = codexObject(change);
    const path = typeof row?.path === 'string' ? row.path : 'File';
    const patch = typeof row?.diff === 'string' ? row.diff : '';
    const entry = `${path}\n${patch}`;
    if (length + entry.length > MAX_PATCH_CHARS) {
      text.push(entry.slice(0, Math.max(0, MAX_PATCH_CHARS - length)));
      text.push('[truncated]');
      valid = false;
      break;
    }
    text.push(entry);
    length += entry.length;
    const diff = parseDiff(path, patch);
    if (!diff) valid = false;
    else items.push(diff);
  }
  if (changes.length > MAX_CHANGES) text.push(`[${changes.length - MAX_CHANGES} more files omitted]`);
  if (valid) return items.length === 1 ? items[0] : { type: 'diffs', items };
  return { type: 'code', path: 'Codex patch.txt', content: text.join('\n') || 'No patch available', created: false };
}
