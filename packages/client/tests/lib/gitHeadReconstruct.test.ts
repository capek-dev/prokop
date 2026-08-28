import { describe, expect, it } from 'vitest';
import type { GitDiffHunk } from '@prokopai/sdk';
import { headFromHunks } from '@/lib/gitHeadReconstruct';

function hunk(overrides: Partial<GitDiffHunk>): GitDiffHunk {
  return {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: 0,
    changes: [],
    ...overrides,
  };
}

describe('headFromHunks', () => {
  it('returns the input unchanged when there are no hunks', () => {
    expect(headFromHunks('a\nb\nc\n', [])).toBe('a\nb\nc\n');
    expect(headFromHunks('a\nb', [])).toBe('a\nb');
    expect(headFromHunks('', [])).toBe('');
  });

  it('reconstructs a single modified hunk', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        changes: [
          { type: 'context', content: 'line1', lineNumber: 1, newLineNumber: 1 },
          { type: 'removed', content: 'CHANGED', lineNumber: 2 },
          { type: 'added', content: 'line2', newLineNumber: 2 },
          { type: 'context', content: 'line3', lineNumber: 3, newLineNumber: 3 },
        ],
      }),
    ];
    expect(headFromHunks('line1\nline2\nline3\n', hunks)).toBe('line1\nCHANGED\nline3\n');
  });

  it('reconstructs multiple hunks with intervening context', () => {
    const newContent = ['h1', 'h2', 'between', 'h3', 'h4'].join('\n') + '\n';
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'removed', content: 'old1', lineNumber: 1 },
          { type: 'added', content: 'h1', newLineNumber: 1 },
          { type: 'removed', content: 'old2', lineNumber: 2 },
          { type: 'added', content: 'h2', newLineNumber: 2 },
        ],
      }),
      hunk({
        oldStart: 4,
        oldLines: 2,
        newStart: 4,
        newLines: 2,
        changes: [
          { type: 'removed', content: 'old3', lineNumber: 4 },
          { type: 'added', content: 'h3', newLineNumber: 4 },
          { type: 'removed', content: 'old4', lineNumber: 5 },
          { type: 'added', content: 'h4', newLineNumber: 5 },
        ],
      }),
    ];
    expect(headFromHunks(newContent, hunks)).toBe('old1\nold2\nbetween\nold3\nold4\n');
  });

  it('reconstructs added-only hunks (file growth)', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 },
          { type: 'added', content: 'b', newLineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('a\nb\n', hunks)).toBe('a\n');
  });

  it('reconstructs removed-only hunks (file shrink)', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 1,
        changes: [
          { type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 },
          { type: 'removed', content: 'b', lineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('a\n', hunks)).toBe('a\nb\n');
  });

  it('handles a larger file growth', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 5,
        changes: [
          { type: 'context', content: '1', lineNumber: 1, newLineNumber: 1 },
          { type: 'added', content: '2', newLineNumber: 2 },
          { type: 'added', content: '3', newLineNumber: 3 },
          { type: 'added', content: '4', newLineNumber: 4 },
          { type: 'context', content: '5', lineNumber: 2, newLineNumber: 5 },
        ],
      }),
    ];
    expect(headFromHunks('1\n2\n3\n4\n5\n', hunks)).toBe('1\n5\n');
  });

  it('reconstructs an empty head for an added-only file (untracked shape)', () => {
    const hunks = [
      hunk({
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'added', content: 'x', newLineNumber: 1 },
          { type: 'added', content: 'y', newLineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('x\ny\n', hunks)).toBe('');
  });

  it('returns null when newLineNumber misaligns with the working copy', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [{ type: 'context', content: 'a', lineNumber: 1, newLineNumber: 5 }],
      }),
    ];
    expect(headFromHunks('a\n', hunks)).toBeNull();
  });

  it('returns null for overlapping hunks', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 },
          { type: 'context', content: 'b', lineNumber: 2, newLineNumber: 2 },
        ],
      }),
      hunk({
        oldStart: 1,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        changes: [{ type: 'context', content: 'b', lineNumber: 1, newLineNumber: 2 }],
      }),
    ];
    expect(headFromHunks('a\nb\nc\n', hunks)).toBeNull();
  });

  it('returns null when claimed context lines are missing from the working copy', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 },
          { type: 'context', content: 'zzz', lineNumber: 2, newLineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('a\n', hunks)).toBeNull();
  });

  it('returns null when context content does not match the working copy', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [{ type: 'context', content: 'stale', lineNumber: 1, newLineNumber: 1 }],
      }),
    ];
    expect(headFromHunks('fresh\n', hunks)).toBeNull();
  });

  it('returns null when hunk old-side accounting does not sum', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 1,
        changes: [{ type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 }],
      }),
    ];
    expect(headFromHunks('a\n', hunks)).toBeNull();
  });

  it('returns null when newStart is invalid for a non-empty file', () => {
    const hunks = [hunk({ oldStart: 1, oldLines: 0, newStart: 0, newLines: 0, changes: [] })];
    expect(headFromHunks('a\n', hunks)).toBeNull();
  });

  it('reconstructs a deleted file from an empty working copy (newStart 0)', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 0,
        newLines: 0,
        changes: [
          { type: 'removed', content: 'foo', lineNumber: 1 },
          { type: 'removed', content: 'bar', lineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('', hunks)).toBe('foo\nbar');
  });

  it('reconstructs a deleted file from an empty working copy (newStart 1, fixture shape)', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 0,
        changes: [
          { type: 'removed', content: 'foo', lineNumber: 1 },
          { type: 'removed', content: 'bar', lineNumber: 2 },
        ],
      }),
    ];
    expect(headFromHunks('', hunks)).toBe('foo\nbar');
  });

  it('does not append a trailing newline when the working copy lacks one', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 2,
        changes: [
          { type: 'context', content: 'foo', lineNumber: 1, newLineNumber: 1 },
          { type: 'context', content: 'bar', lineNumber: 2, newLineNumber: 2 },
          { type: 'removed', content: 'baz', lineNumber: 3 },
        ],
      }),
    ];
    expect(headFromHunks('foo\nbar', hunks)).toBe('foo\nbar\nbaz');
  });

  it('preserves the trailing newline state of the working copy', () => {
    const hunks = [
      hunk({
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [{ type: 'context', content: 'a', lineNumber: 1, newLineNumber: 1 }],
      }),
    ];
    expect(headFromHunks('a\n', hunks)).toBe('a\n');
  });
});
