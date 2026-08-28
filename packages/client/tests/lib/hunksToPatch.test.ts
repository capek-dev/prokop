import { describe, expect, it } from 'vitest';
import { hunksToPatch } from '@/lib/hunksToPatch';
import type { DiffHunk } from '@/utils/diff';

function hunk(overrides: Partial<DiffHunk>): DiffHunk {
  return {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 0,
    changes: [],
    ...overrides,
  };
}

describe('hunksToPatch', () => {
  it('emits file headers and a simple modification', () => {
    const patch = hunksToPatch(
      [
        hunk({
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 3,
          changes: [
            { type: 'context', content: 'a' },
            { type: 'removed', content: 'b' },
            { type: 'added', content: 'B' },
            { type: 'context', content: 'c' },
          ],
        }),
      ],
      'src/app.ts',
    );
    expect(patch).toBe(
      ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'].join('\n'),
    );
  });

  it('emits the bare start form for empty ranges', () => {
    const patch = hunksToPatch(
      [hunk({ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, changes: [{ type: 'added', content: 'x' }] })],
      'new.txt',
    );
    expect(patch).toContain('@@ -0 +1,2 @@');
  });

  it('serializes multiple hunks in order', () => {
    const patch = hunksToPatch(
      [
        hunk({
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          changes: [{ type: 'context', content: 'one' }],
        }),
        hunk({
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 1,
          changes: [{ type: 'context', content: 'ten' }],
        }),
      ],
      'f.txt',
    );
    expect(patch).toContain('@@ -1,1 +1,1 @@');
    expect(patch).toContain('@@ -10,1 +10,1 @@');
    const firstHunk = patch.indexOf('@@ -1,1');
    const secondHunk = patch.indexOf('@@ -10,1');
    expect(firstHunk).toBeLessThan(secondHunk);
  });

  it('keeps content verbatim, including leading whitespace and +/− glyphs', () => {
    const patch = hunksToPatch(
      [
        hunk({
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          changes: [
            { type: 'context', content: '  indent' },
            { type: 'added', content: '+not-a-marker' },
          ],
        }),
      ],
      'f.txt',
    );
    expect(patch).toContain('   indent');
    expect(patch).toContain('++not-a-marker');
  });

  it('handles empty hunks array as headers only', () => {
    const patch = hunksToPatch([], 'f.txt');
    expect(patch).toBe(['--- a/f.txt', '+++ b/f.txt'].join('\n'));
  });
});
