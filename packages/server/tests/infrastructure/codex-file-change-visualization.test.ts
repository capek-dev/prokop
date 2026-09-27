import { expect, test } from 'bun:test';
import { fileChangeVisualization } from '@/harnesses/codex-cli/file-change-visualization';

const patch = [
  '--- a/src/main.rs',
  '+++ b/src/main.rs',
  '@@ -1,3 +1,3 @@',
  ' use crate::load;',
  '-println!("old");',
  '+println!("new");',
  ' persist(&store);',
  '@@ -10 +10,2 @@ fn main() {',
  '-return;',
  '+save();',
  '+return;',
  '',
].join('\n');

test('Codex file changes produce line-numbered diffs for one or several files', () => {
  const first = fileChangeVisualization([{ path: 'src/main.rs', kind: { type: 'update' }, diff: patch }]);
  expect(first).toMatchObject({ type: 'diff', path: 'src/main.rs', additions: 3, deletions: 2,
    hunks: [
      { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, changes: [
        { type: 'context', content: 'use crate::load;', oldLineNumber: 1, newLineNumber: 1 },
        { type: 'removed', content: 'println!("old");', oldLineNumber: 2 },
        { type: 'added', content: 'println!("new");', newLineNumber: 2 },
        { type: 'context', content: 'persist(&store);', oldLineNumber: 3, newLineNumber: 3 },
      ] },
      { oldStart: 10, oldLines: 1, newStart: 10, newLines: 2, changes: [
        { type: 'removed', content: 'return;', oldLineNumber: 10 },
        { type: 'added', content: 'save();', newLineNumber: 10 },
        { type: 'added', content: 'return;', newLineNumber: 11 },
      ] },
    ] });
  expect(fileChangeVisualization([
    { path: 'src/main.rs', diff: patch },
    { path: 'src/lib.rs', diff: '@@ -0,0 +1 @@\n+new\n' },
  ])).toMatchObject({ type: 'diffs', items: [
    { path: 'src/main.rs' }, { path: 'src/lib.rs', hunks: [{ oldLines: 0, newLines: 1 }] },
  ] });
});

test('incomplete, oversized and missing patches stay readable without misleading partial diffs', () => {
  for (const diff of ['+new line', '@@ -1,2 +1,2 @@\n-old\n+new', `${patch}${'x'.repeat(8_000)}`]) {
    const visualization = fileChangeVisualization([{ path: 'src/main.rs', diff }]);
    expect(visualization.type).toBe('code');
    if (visualization.type === 'code') expect(visualization.content).toContain('src/main.rs');
  }
  expect(fileChangeVisualization([{ path: 'src/main.rs' }])).toMatchObject({ type: 'code' });
  expect(fileChangeVisualization([])).toMatchObject({ type: 'code' });
  expect(fileChangeVisualization(Array.from({ length: 51 }, (_, i) => ({
    path: `src/${i}.rs`, diff: '@@ -0,0 +1 @@\n+new',
  })))).toMatchObject({ type: 'code' });
});
