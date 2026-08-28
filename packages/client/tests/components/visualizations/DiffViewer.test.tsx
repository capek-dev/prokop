import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
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
// mock surfaces the serialized patch so content assertions stay behavioral.
vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: ({ patch }: { patch: string }) => (
    <div data-testid="patch-diff">{patch}</div>
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
    expect(patchEl.textContent).toContain('--- a/src/app-serialize.tsx');
    expect(patchEl.textContent).toContain('+++ b/src/app-serialize.tsx');
    expect(patchEl.textContent).toContain('@@ -1,3 +1,3 @@');
    expect(patchEl.textContent).toContain('-old line');
    expect(patchEl.textContent).toContain('+new line');
    expect(patchEl.textContent).toContain(' unchanged line');
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
});
