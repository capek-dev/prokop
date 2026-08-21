import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { GitDiffChange, GitDiffHunk } from '@prokopai/sdk';
import {
  createGitDiffExtension,
  isGitDiffRemovedContentTruncated,
  parseGitDiffHunks,
} from '@/components/editor/gitDiffExtension';

function change(type: GitDiffChange['type'], content: string): GitDiffChange {
  return { type, content };
}

function hunk(newStart: number, changes: GitDiffChange[]): GitDiffHunk {
  return {
    oldStart: 1,
    oldLines: 0,
    newStart,
    newLines: changes.filter((item) => item.type !== 'removed').length,
    changes,
  };
}

describe('parseGitDiffHunks', () => {
  test('classifies an added-only hunk', () => {
    const parsed = parseGitDiffHunks([
      hunk(2, [change('added', 'a'), change('added', 'b')]),
    ]);

    expect(parsed.lineEntries).toEqual([
      { line: 1, kind: 'added' },
      { line: 2, kind: 'added' },
    ]);
    expect(parsed.gutterEntries).toEqual([
      { line: 1, kind: 'added' },
      { line: 2, kind: 'added' },
    ]);
    expect(parsed.removedBlocks).toEqual([]);
  });

  test('emits removed content and a deleted marker for a removed-only hunk', () => {
    const parsed = parseGitDiffHunks([
      hunk(1, [change('removed', 'old a'), change('removed', 'old b')]),
    ]);

    expect(parsed.lineEntries).toEqual([]);
    expect(parsed.removedBlocks).toEqual([
      { anchorLine: 0, lines: ['old a', 'old b'], id: 'r-0-0' },
    ]);
    expect(parsed.gutterEntries).toEqual([{ line: 0, kind: 'deleted' }]);
  });

  test('classifies adjacent removed and added lines as modified', () => {
    const parsed = parseGitDiffHunks([
      hunk(1, [
        change('removed', 'old'),
        change('added', 'new a'),
        change('added', 'new b'),
      ]),
    ]);

    expect(parsed.lineEntries).toEqual([
      { line: 0, kind: 'modified' },
      { line: 1, kind: 'modified' },
    ]);
    expect(parsed.gutterEntries).toEqual([
      { line: 0, kind: 'deleted' },
      { line: 0, kind: 'modified' },
      { line: 1, kind: 'modified' },
    ]);
  });

  test('resets modification classification after context', () => {
    const parsed = parseGitDiffHunks([
      hunk(1, [
        change('removed', 'old'),
        change('context', 'keep'),
        change('added', 'new'),
      ]),
    ]);

    expect(parsed.lineEntries).toEqual([{ line: 1, kind: 'added' }]);
    expect(parsed.gutterEntries).toEqual([
      { line: 0, kind: 'deleted' },
      { line: 1, kind: 'added' },
    ]);
  });

  test.each([
    {
      name: 'before the first surviving line',
      changes: [change('removed', 'old'), change('context', 'first')],
      anchorLine: 0,
    },
    {
      name: 'between surviving lines',
      changes: [change('context', 'first'), change('removed', 'old'), change('context', 'second')],
      anchorLine: 1,
    },
    {
      name: 'after the final surviving line',
      changes: [change('context', 'last'), change('removed', 'old')],
      anchorLine: 1,
    },
    {
      name: 'for a whole-file deletion',
      changes: [change('removed', 'old')],
      anchorLine: 0,
    },
  ])('anchors deleted content $name', ({ changes, anchorLine }) => {
    const parsed = parseGitDiffHunks([hunk(1, changes)]);

    expect(parsed.removedBlocks[0]?.anchorLine).toBe(anchorLine);
    expect(parsed.gutterEntries).toContainEqual({ line: anchorLine, kind: 'deleted' });
  });

  test('keeps all gutter entries while limiting removed widgets', () => {
    const hunks = Array.from({ length: 501 }, (_, index) =>
      hunk(index + 1, [change('removed', `old-${index}`)]),
    );
    const parsed = parseGitDiffHunks(hunks);

    expect(parsed.removedBlocks).toHaveLength(500);
    expect(parsed.gutterEntries).toHaveLength(501);
    expect(parsed.removedContentTruncated).toBe(true);
    expect(isGitDiffRemovedContentTruncated(hunks)).toBe(true);
  });

  test('returns empty, untruncated output for an empty diff', () => {
    expect(parseGitDiffHunks([])).toEqual({
      lineEntries: [],
      removedBlocks: [],
      gutterEntries: [],
      removedContentTruncated: false,
    });
    expect(isGitDiffRemovedContentTruncated([])).toBe(false);
  });
});

describe('createGitDiffExtension', () => {
  test('provides sorted block decorations directly from editor state', () => {
    const controller = createGitDiffExtension();
    const state = EditorState.create({
      doc: 'new',
      extensions: [controller.extension],
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    try {
      expect(() =>
        controller.setDiff(view, {
          hunks: [hunk(1, [change('removed', 'old'), change('added', 'new')])],
          additions: 1,
          deletions: 1,
        }),
      ).not.toThrow();
    } finally {
      view.destroy();
      parent.remove();
    }
  });
});
