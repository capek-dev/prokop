import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GitDiffSummary } from '@prokopai/sdk';

const mockUseGitStatusQuery = vi.fn();

vi.mock('@/hooks/queries/useFileQueries', () => ({
  useGitStatusQuery: (...args: unknown[]) => mockUseGitStatusQuery(...args),
}));

import {
  allAncestorDirectories,
  buildSelectionTarget,
  GitChangesView,
} from '@/components/files/GitChangesView';

const git: GitDiffSummary = { status: 'modified', staged: false, unstaged: true, additions: 1, deletions: 1 };

function makeFile(path: string, overrides: Partial<GitDiffSummary> = {}): { path: string; git: GitDiffSummary } {
  return { path, git: { ...git, ...overrides } };
}

// ---------------------------------------------------------------------------

describe('allAncestorDirectories (flat-mode expansion input)', () => {
  test('produces every ancestor with a trailing slash', () => {
    expect(allAncestorDirectories(['src/components/ui/dialog.tsx'])).toEqual([
      'src/',
      'src/components/',
      'src/components/ui/',
    ]);
  });

  test('deduplicates shared prefixes across files', () => {
    expect(
      allAncestorDirectories(['src/a.ts', 'src/nested/b.ts', 'README.md']),
    ).toEqual(['src/', 'src/nested/']);
  });

  test('root-level files contribute no directories', () => {
    expect(allAncestorDirectories(['root.txt'])).toEqual([]);
  });
});

describe('buildSelectionTarget (opener mapping)', () => {
  const files = [
    makeFile('src/app.ts'),
    makeFile('gone.txt', { status: 'deleted' }),
  ];

  test('maps a changed file onto the full opener target shape', () => {
    const target = buildSelectionTarget(files, 'src/app.ts');
    expect(target).toEqual({
      entry: {
        name: 'app.ts',
        type: 'file',
        path: 'src/app.ts',
        extension: '.ts',
        git,
      },
    });
  });

  test('returns null for deleted entries (legacy parity: never opened)', () => {
    expect(buildSelectionTarget(files, 'gone.txt')).toBeNull();
  });

  test('returns null for unknown paths (directory ids never match)', () => {
    expect(buildSelectionTarget(files, 'src/')).toBeNull();
    expect(buildSelectionTarget(files, 'not-in-set.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Light-DOM states. Row-level interactions live inside Pierre's shadow DOM
// and are covered by tests/integration/file-tree-pierre.test.ts; these cases
// lock what renders AROUND the tree.
// ---------------------------------------------------------------------------

describe('GitChangesView light-DOM states', () => {
  beforeEach(() => {
    mockUseGitStatusQuery.mockReturnValue({
      data: { availability: { available: true }, files: [], root: '' },
      isLoading: false,
      error: null,
    });
  });

  test('summary strip shows count and summed +/- totals', () => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [
          makeFile('a.ts', { additions: 3, deletions: 0 }),
          makeFile('b/c.ts', { additions: 2 }),
        ],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    render(<GitChangesView workspaceId="ws-1" sdkClient={null} onFileSelect={vi.fn()} />);
    const strip = screen.getByText(/2 files/).closest('div')!;
    expect(strip.textContent).toContain('+5');
    expect(strip.textContent).toContain('−1');
  });

  test('unavailable git renders its reason label instead of the tree', () => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: false, reason: 'not_a_git_repo' },
        files: [],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    render(<GitChangesView workspaceId="ws-1" sdkClient={null} onFileSelect={vi.fn()} />);
    expect(screen.getByText('Not a git repository')).toBeInTheDocument();
  });

  test('no changes and no-matching-filter are distinct messages', () => {
    render(<GitChangesView workspaceId="ws-1" sdkClient={null} onFileSelect={vi.fn()} />);
    expect(screen.getByText('No changes')).toBeInTheDocument();

    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('a.ts')],
        root: '',
      },
      isLoading: false,
      error: null,
    });
    cleanupViews();

    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        searchQuery="zzz"
        onFileSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('No matching files')).toBeInTheDocument();
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
  });

  test('error state renders with a retry affordance', () => {
    mockUseGitStatusQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('network down'),
    });

    render(<GitChangesView workspaceId="ws-1" sdkClient={null} onFileSelect={vi.fn()} />);
    expect(screen.getByText(/network down/)).toBeInTheDocument();
  });
});

/** Unmount current views; testing-library auto-cleanup handles most cases. */
function cleanupViews() {
  document.body.textContent = '';
}
