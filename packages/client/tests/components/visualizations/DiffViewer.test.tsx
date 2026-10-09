import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { FileDiffMetadata } from '@pierre/diffs';
import { DiffViewer } from '@/components/visualizations/DiffViewer';

vi.mock('@/stores/uiStore', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openFilePreview: vi.fn() }),
  ),
}));

vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({ activeWorkspace: { id: 'ws-1', name: 'test' } }),
  ),
}));

// Pierre renders into shadow DOM, invisible to light-DOM text queries; the
// mock surfaces the parsed diff (real parsePatchFiles) so content assertions
// stay behavioral.
vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({ fileDiff }: { fileDiff: FileDiffMetadata }) => (
    <div data-testid="patch-diff" data-name={fileDiff.name} data-cache-key={fileDiff.cacheKey}>
      {fileDiff.hunks.map((hunk) => hunk.hunkSpecs).join('\n')}
      {'\n'}
      {fileDiff.deletionLines.map((line) => `-${line}`).join('')}
      {fileDiff.additionLines.map((line) => `+${line}`).join('')}
    </div>
  ),
  PatchDiff: ({ patch }: { patch: string }) => (
    <div data-testid="patch-diff-fallback">{patch}</div>
  ),
}));

const sampleHunks = [
  {
    oldStart: 1,
    oldLines: 3,
    newStart: 1,
    newLines: 3,
    changes: [
      { type: 'context' as const, content: 'unchanged line', lineNumber: 1, newLineNumber: 1 },
      { type: 'removed' as const, content: 'old line', lineNumber: 2 },
      { type: 'added' as const, content: 'new line', newLineNumber: 2 },
    ],
  },
];

describe('DiffViewer', () => {
  it('renders file path in header', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-header.tsx" />);
    expect(screen.getByText('src/app-header.tsx')).toBeInTheDocument();
  });

  it('serializes hunks into the rendered patch', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-serialize.tsx" />);
    const patchEl = screen.getByTestId('patch-diff');
    // hunksToPatch emits plain ---/+++ headers, so Pierre keeps the b/ prefix.
    expect(patchEl.getAttribute('data-name')).toBe('b/src/app-serialize.tsx');
    expect(patchEl.textContent).toContain('@@ -1,3 +1,3 @@');
    expect(patchEl.textContent).toContain('-old line');
    expect(patchEl.textContent).toContain('+new line');
    expect(patchEl.textContent).toContain('unchanged line');
  });

  it('keys the diff by content so remounts reuse the worker highlight cache', () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-key.tsx" />);
    const firstKey = screen.getByTestId('patch-diff').getAttribute('data-cache-key');
    unmount();
    render(<DiffViewer hunks={sampleHunks} path="src/app-key.tsx" />);
    expect(screen.getByTestId('patch-diff').getAttribute('data-cache-key')).toBe(firstKey);
    expect(firstKey).toBeTruthy();
  });

  it('changes the cache key when the diff content changes', () => {
    const { unmount } = render(<DiffViewer hunks={sampleHunks} path="src/app-rekey.tsx" />);
    const firstKey = screen.getByTestId('patch-diff').getAttribute('data-cache-key');
    unmount();
    const edited = [{
      ...sampleHunks[0],
      changes: [
        ...sampleHunks[0].changes.slice(0, 2),
        { type: 'added' as const, content: 'other line', newLineNumber: 2 },
      ],
    }];
    render(<DiffViewer hunks={edited} path="src/app-rekey.tsx" />);
    expect(screen.getByTestId('patch-diff').getAttribute('data-cache-key')).not.toBe(firstKey);
  });

  it('displays additions and deletions count', () => {
    render(
      <DiffViewer hunks={sampleHunks} path="src/app-counts.tsx" additions={5} deletions={3} />,
    );
    expect(screen.getByText('+5 -3')).toBeInTheDocument();
  });

  it('hides additions/deletions when not provided', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-nocounts.tsx" />);
    expect(screen.queryByText(/^\+\d+ -\d+$/)).not.toBeInTheDocument();
  });

  it('collapses diff when expand button clicked', async () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-collapse.tsx" />);
    const expandBtn = screen.getAllByRole('button')[0];
    await userEvent.click(expandBtn);

    expect(screen.queryByTestId('patch-diff')).not.toBeInTheDocument();
  });

  it('expands diff again when button clicked twice', async () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-twice.tsx" />);
    const expandBtn = screen.getAllByRole('button')[0];
    await userEvent.click(expandBtn);
    await userEvent.click(expandBtn);

    expect(screen.getByTestId('patch-diff')).toBeInTheDocument();
  });

  it('renders multiple hunks', () => {
    const multiHunks = [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        changes: [
          { type: 'added' as const, content: 'hunk1 line', newLineNumber: 1 },
        ],
      },
      {
        oldStart: 10,
        oldLines: 1,
        newStart: 10,
        newLines: 1,
        changes: [
          { type: 'added' as const, content: 'hunk2 line', newLineNumber: 10 },
        ],
      },
    ];
    render(<DiffViewer hunks={multiHunks} path="src/app-multihunk.tsx" />);
    const patchEl = screen.getByTestId('patch-diff');
    expect(patchEl.textContent).toContain('+hunk1 line');
    expect(patchEl.textContent).toContain('+hunk2 line');
  });

  it('has file path button with title', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-title.tsx" />);
    const pathButton = screen.getByTitle('src/app-title.tsx');
    expect(pathButton).toBeInTheDocument();
  });

  it('wraps the expanded diff body in the capped scroll area', () => {
    render(<DiffViewer hunks={sampleHunks} path="src/app-scroll.tsx" />);
    const patchEl = screen.getByTestId('patch-diff');
    expect(patchEl.parentElement?.className).toContain('tool-output-scroll');
    // Header row stays outside the scroll area.
    expect(screen.getByTitle('src/app-scroll.tsx').closest('.tool-output-scroll')).toBeNull();
  });

  it('renders no scroll area when collapsed', async () => {
    const { container } = render(<DiffViewer hunks={sampleHunks} path="src/app-noscroll.tsx" />);
    const expandBtn = screen.getAllByRole('button')[0];
    await userEvent.click(expandBtn);

    expect(container.querySelector('.tool-output-scroll')).not.toBeInTheDocument();
  });
});
