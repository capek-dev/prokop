import type { DiffHunk } from '@/utils/diff';

/**
 * Serialize tool-call diff hunks into unified-diff patch text for
 * `PatchDiff` (the Pierre renderer). The format is the plain unified diff:
 * `--- a/<path>` / `+++ b/<path>` file headers plus `@@ -o,n +m,k @@` hunks.
 *
 * Ranges are reconstructed from the hunk headers rather than the change
 * stream, so the emitted counts always match what the server sent. A hunk
 * claiming zero lines on a side emits the bare `<start>` form.
 */
export function hunksToPatch(hunks: DiffHunk[], path: string): string {
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];

  for (const hunk of hunks) {
    const oldRange = hunk.oldLines > 0 ? `${hunk.oldStart},${hunk.oldLines}` : `${hunk.oldStart}`;
    const newRange = hunk.newLines > 0 ? `${hunk.newStart},${hunk.newLines}` : `${hunk.newStart}`;
    lines.push(`@@ -${oldRange} +${newRange} @@`);

    for (const change of hunk.changes) {
      if (change.type === 'added') {
        lines.push(`+${change.content}`);
      } else if (change.type === 'removed') {
        lines.push(`-${change.content}`);
      } else {
        lines.push(` ${change.content}`);
      }
    }
  }

  return lines.join('\n');
}
