import type { GitDiffHunk } from '@prokopai/sdk';

/**
 * Reconstruct the HEAD (old) version of a file from the working-tree content
 * and git diff hunks. Returns null when the hunks cannot be aligned with the
 * working copy (malformed or stale diff data) — callers must fall back to a
 * plain file render, never render a wrong diff.
 *
 * The hunks walk the new side in order while the old side is rebuilt from
 * removed lines plus context lines copied from the working copy. Every
 * alignment failure (unsorted/overlapping hunks, misaligned line numbers,
 * missing context lines, or old/new line-count mismatches) fails closed.
 *
 * Trailing newline caveat: the old side's trailing-newline state is not
 * carried in SDK hunk payloads (git diff's `\ No newline at end of file`
 * markers are dropped). Splitting keeps the trailing empty element for files
 * ending in `\n`, so the reconstruction mirrors the NEW side's trailing
 * newline; files differing only in trailing newline therefore reconstruct
 * identically and re-diff as no change — technically correct.
 */
export function headFromHunks(newContent: string, hunks: GitDiffHunk[]): string | null {
  // split('\n') keeps a final empty element when the file ends with '\n';
  // a truly empty file normalizes to zero lines (no phantom element).
  const newLines = newContent === '' ? [] : newContent.split('\n');
  const oldLines: string[] = [];
  let newCursor = 0;

  for (const hunk of hunks) {
    // newStart is 1-based on the new side; 0 means the new side is empty
    // (deleted/emptied file). A non-empty file must never claim a 0 anchor.
    if (newContent !== '' && hunk.newStart < 1) return null;
    const hunkNewStart = Math.max(0, hunk.newStart - 1);

    // Copy unchanged context before this hunk. If the cursor overshoots the
    // hunk anchor the hunks overlap or are unsorted — fail closed.
    while (newCursor < hunkNewStart) {
      if (newCursor >= newLines.length) return null;
      oldLines.push(newLines[newCursor]);
      newCursor++;
    }
    if (newCursor !== hunkNewStart) return null;

    let oldConsumed = 0;
    let newConsumed = 0;
    for (const change of hunk.changes) {
      if (change.type === 'context' || change.type === 'added') {
        // New-side lines must exist at the claimed position with matching
        // content; `newLineNumber` (when present) must equal the actual
        // working line about to be consumed.
        if (newCursor >= newLines.length) return null;
        if (change.newLineNumber !== undefined && change.newLineNumber !== newCursor + 1) {
          return null;
        }
        if (change.content !== newLines[newCursor]) return null;
        newCursor++;
        newConsumed++;
        if (change.type === 'context') {
          oldLines.push(change.content);
          oldConsumed++;
        }
      } else if (change.type === 'removed') {
        oldLines.push(change.content);
        oldConsumed++;
      }
    }

    // Per-hunk old/new side accounting must match the hunk headers.
    if (oldConsumed !== hunk.oldLines) return null;
    if (newConsumed !== hunk.newLines) return null;
  }

  // Append the remainder after the last hunk.
  while (newCursor < newLines.length) {
    oldLines.push(newLines[newCursor]);
    newCursor++;
  }

  return oldLines.join('\n');
}
