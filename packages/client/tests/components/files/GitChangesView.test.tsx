import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GitDiffSummary } from '@prokopai/sdk';
import type { FileEntryActionTarget } from '@/components/files/FileEntryContextMenu';

const mockUseGitStatusQuery = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useGitStatusQuery: (...args: unknown[]) => mockUseGitStatusQuery(...args),
}));

import { buildChangedFilesTree } from '@/components/files/GitChangesView';
import { GitChangesView } from '@/components/files/GitChangesView';

const git: GitDiffSummary = { status: 'modified', staged: false, unstaged: true, additions: 1, deletions: 1 };

function makeFile(path: string, overrides: Partial<GitDiffSummary> = {}): { path: string; git: GitDiffSummary } {
  return { path, git: { ...git, ...overrides } };
}

// ---------------------------------------------------------------------------

describe('buildChangedFilesTree', () => {
  test('root-level files remain at root', () => {
    const tree = buildChangedFilesTree([
      makeFile('README.md'),
      makeFile('package.json'),
    ]);

    expect(tree.directories).toHaveLength(0);
    expect(tree.files.map((f) => f.path)).toEqual(['package.json', 'README.md']);
  });

  test('one-level directories produce one directory node', () => {
    const tree = buildChangedFilesTree([
      makeFile('src/app.ts'),
      makeFile('src/index.ts'),
    ]);

    expect(tree.directories).toHaveLength(1);
    const src = tree.directories[0]!;
    expect(src.name).toBe('src');
    expect(src.path).toBe('src');
    expect(src.files.map((f) => f.path)).toEqual(['src/app.ts', 'src/index.ts']);
    expect(src.directories).toHaveLength(0);
    expect(src.fileCount).toBe(2);
    expect(tree.files).toHaveLength(0);
  });

  test('multi-level paths produce every intermediate directory node', () => {
    const tree = buildChangedFilesTree([
      makeFile('src/components/ui/dialog.tsx'),
    ]);

    expect(tree.directories).toHaveLength(1);
    const src = tree.directories[0]!;
    expect(src.name).toBe('src');
    expect(src.path).toBe('src');
    expect(src.directories).toHaveLength(1);

    const components = src.directories[0]!;
    expect(components.name).toBe('components');
    expect(components.path).toBe('src/components');
    expect(components.directories).toHaveLength(1);

    const ui = components.directories[0]!;
    expect(ui.name).toBe('ui');
    expect(ui.path).toBe('src/components/ui');
    expect(ui.files.map((f) => f.path)).toEqual(['src/components/ui/dialog.tsx']);
    expect(ui.directories).toHaveLength(0);

    // Recursive counts
    expect(ui.fileCount).toBe(1);
    expect(components.fileCount).toBe(1);
    expect(src.fileCount).toBe(1);
  });

  test('files sharing a partial path share the same directory nodes', () => {
    const tree = buildChangedFilesTree([
      makeFile('src/app/App.tsx'),
      makeFile('src/components/Button.tsx'),
      makeFile('src/components/ui/dialog.tsx'),
    ]);

    expect(tree.directories).toHaveLength(1);
    const src = tree.directories[0]!;
    expect(src.directories).toHaveLength(2);
    expect(src.directories.map((d) => d.name)).toEqual(['app', 'components']);
    expect(src.fileCount).toBe(3);

    const components = src.directories.find((d) => d.name === 'components')!;
    expect(components.directories).toHaveLength(1);
    expect(components.directories[0]!.name).toBe('ui');
    expect(components.directories[0]!.files.map((f) => f.path)).toEqual(['src/components/ui/dialog.tsx']);
    expect(components.files.map((f) => f.path)).toEqual(['src/components/Button.tsx']);
    expect(components.fileCount).toBe(2);
  });

  test('directory paths are unique and repository-relative', () => {
    const tree = buildChangedFilesTree([
      makeFile('src/a.ts'),
      makeFile('lib/a.ts'),
      makeFile('src/nested/a.ts'),
    ]);

    const allPaths: string[] = [];
    function collect(dirs: typeof tree.directories) {
      for (const d of dirs) {
        allPaths.push(d.path);
        collect(d.directories);
      }
    }
    collect(tree.directories);

    expect(allPaths).toEqual(['lib', 'src', 'src/nested']);
    expect(new Set(allPaths).size).toBe(allPaths.length);
  });

  test('recursive file counts include all descendants', () => {
    const tree = buildChangedFilesTree([
      makeFile('src/a.ts'),
      makeFile('src/b/a.ts'),
      makeFile('src/b/c/d.ts'),
      makeFile('src/e/f.ts'),
    ]);

    const src = tree.directories[0]!;
    expect(src.fileCount).toBe(4);

    const b = src.directories[0]!;
    expect(b.name).toBe('b');
    expect(b.fileCount).toBe(2);

    const c = b.directories[0]!;
    expect(c.name).toBe('c');
    expect(c.fileCount).toBe(1);

    const e = src.directories[1]!;
    expect(e.name).toBe('e');
    expect(e.fileCount).toBe(1);
  });

  test('directories are sorted alphabetically before files at every level', () => {
    const tree = buildChangedFilesTree([
      makeFile('zroot.txt'),
      makeFile('src/zebra.ts'),
      makeFile('src/apple.ts'),
      makeFile('src/mango.ts'),
      makeFile('src/z_dir/a.ts'),
      makeFile('src/a_dir/b.ts'),
      makeFile('README.md'),
    ]);

    // Root level
    expect(tree.directories.map((d) => d.name)).toEqual(['src']);
    expect(tree.files.map((f) => f.path)).toEqual(['README.md', 'zroot.txt']);

    // src level: directories before files
    const src = tree.directories[0]!;
    expect(src.directories.map((d) => d.name)).toEqual(['a_dir', 'z_dir']);
    expect(src.files.map((f) => f.path)).toEqual([
      'src/apple.ts',
      'src/mango.ts',
      'src/zebra.ts',
    ]);
  });

  test('original file paths and git summaries remain attached to file leaves', () => {
    const customGit: GitDiffSummary = { status: 'added', staged: true, unstaged: false, additions: 10 };
    const tree = buildChangedFilesTree([
      { path: 'src/app.ts', git: customGit },
    ]);

    const file = tree.directories[0]!.files[0]!;
    expect(file.path).toBe('src/app.ts');
    expect(file.git).toBe(customGit);
  });

  test('does not mutate the input array', () => {
    const files = [
      makeFile('b.ts'),
      makeFile('a.ts'),
    ];
    const original = [...files];

    buildChangedFilesTree(files);

    expect(files.map((f) => f.path)).toEqual(original.map((f) => f.path));
  });

  test('handles paths with no directory segment', () => {
    const tree = buildChangedFilesTree([makeFile('root.txt')]);

    expect(tree.directories).toHaveLength(0);
    expect(tree.files.map((f) => f.path)).toEqual(['root.txt']);
  });
});

// ---------------------------------------------------------------------------

describe('GitChangesView - grouped mode rendering', () => {
  beforeEach(() => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [],
        root: '',
      },
      isLoading: false,
      error: null,
    });
  });

  function fireView(props: Partial<React.ComponentProps<typeof GitChangesView>> = {}) {
    const onFileSelect = vi.fn();
    const defaultProps: React.ComponentProps<typeof GitChangesView> = {
      workspaceId: 'ws-1',
      sdkClient: null,
      mode: 'grouped',
      onFileSelect,
      ...props,
    };
    const result = render(<GitChangesView {...defaultProps} />);
    return { ...result, onFileSelect };
  }

  test('directories start collapsed and nested files are not visible', () => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/components/ui/dialog.tsx')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView();

    expect(screen.getByText('src')).toBeInTheDocument();
    // Nested directory names and file names should not be visible while collapsed
    expect(screen.queryByText('components')).not.toBeInTheDocument();
    expect(screen.queryByText('dialog.tsx')).not.toBeInTheDocument();
  });

  test('expanding a directory reveals its immediate children', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/app.ts'), makeFile('src/components/Button.tsx')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView();

    await user.click(screen.getByText('src'));

    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.getByText('components')).toBeInTheDocument();
    // Deeper nested file still hidden until components is expanded
    expect(screen.queryByText('Button.tsx')).not.toBeInTheDocument();
  });

  test('each directory can be expanded or collapsed independently', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/a.ts'), makeFile('lib/b.ts')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView();

    // Expand src only
    await user.click(screen.getByText('src'));
    expect(screen.getByText('a.ts')).toBeInTheDocument();

    // lib is still collapsed
    expect(screen.queryByText('b.ts')).not.toBeInTheDocument();

    // Expand lib independently
    await user.click(screen.getByText('lib'));
    expect(screen.getByText('b.ts')).toBeInTheDocument();

    // Collapse src, lib should still show its file
    await user.click(screen.getByText('src'));
    expect(screen.queryByText('a.ts')).not.toBeInTheDocument();
    expect(screen.getByText('b.ts')).toBeInTheDocument();
  });

  test('nested file row displays the file name, not the directory prefix', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/components/ui/dialog.tsx')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView();

    // Expand the full chain
    await user.click(screen.getByText('src'));
    await user.click(screen.getByText('components'));
    await user.click(screen.getByText('ui'));

    const fileButton = screen.getByText('dialog.tsx').closest('button')!;
    // Should not contain the directory prefix text
    expect(fileButton.textContent).not.toContain('src/components/ui/');
    expect(fileButton.textContent).toContain('dialog.tsx');
  });

  test('selecting a deeply nested file emits its complete original path', async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/components/ui/dialog.tsx')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView({ onFileSelect });

    await user.click(screen.getByText('src'));
    await user.click(screen.getByText('components'));
    await user.click(screen.getByText('ui'));
    await user.click(screen.getByText('dialog.tsx'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.entry.path).toBe('src/components/ui/dialog.tsx');
    expect(target.entry.name).toBe('dialog.tsx');
    expect(target.entry.type).toBe('file');
    // Main root uses undefined at the opener boundary.
    expect(target.root).toBeUndefined();
  });

  test('root-level files remain selectable', async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('README.md')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView({ onFileSelect });

    await user.click(screen.getByText('README.md'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.entry.path).toBe('README.md');
    expect(target.entry.name).toBe('README.md');
    expect(target.entry.type).toBe('file');
    expect(target.root).toBeUndefined();
  });

  test('directory count badge shows recursive file count', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [
          makeFile('src/a.ts'),
          makeFile('src/b/c.ts'),
          makeFile('src/b/d.ts'),
          makeFile('src/e/f.ts'),
        ],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireView();

    // src has 4 changed files total
    expect(screen.getByText('4')).toBeInTheDocument();

    await user.click(screen.getByText('src'));

    // b has 2
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    // e has 1
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe('GitChangesView - flat mode', () => {
  function fireFlat(props: Partial<React.ComponentProps<typeof GitChangesView>> = {}) {
    const onFileSelect = vi.fn();
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        mode="flat"
        onFileSelect={onFileSelect}
        {...props}
      />,
    );
    return { onFileSelect };
  }

  test('displays full paths with muted directory text', () => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/app/index.ts')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireFlat();

    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('src/app/')).toBeInTheDocument();
  });

  test('selecting a file in flat mode emits the full path', async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/deep/nested/file.ts')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    fireFlat({ onFileSelect });

    await user.click(screen.getByText('file.ts'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.entry.path).toBe('src/deep/nested/file.ts');
    expect(target.root).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 4: The opener receives a complete FileEntryActionTarget carrying the
// root of the selected row, so actions target the exact root regardless of
// the currently selected panel root.
// ---------------------------------------------------------------------------

describe('GitChangesView - FileEntryActionTarget root preservation', () => {
  beforeEach(() => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [],
        root: '',
      },
      isLoading: false,
      error: null,
    });
  });

  function renderWithRoot(root: string | undefined) {
    const onFileSelect = vi.fn();
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        root={root}
        mode="flat"
        onFileSelect={onFileSelect}
      />,
    );
    return { onFileSelect };
  }

  test('the callback target carries the additional root passed to the view', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/app.ts')],
        root: '/extra/root',
      },
      isLoading: false,
      error: null,
    });

    const { onFileSelect } = renderWithRoot('/extra/root');

    await user.click(screen.getByText('app.ts'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.root).toBe('/extra/root');
    expect(target.entry.path).toBe('src/app.ts');
  });

  test('main root is represented as undefined in the target', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('README.md')],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    const { onFileSelect } = renderWithRoot(undefined);

    await user.click(screen.getByText('README.md'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    // Main root uses undefined at the opener boundary.
    expect(target.root).toBeUndefined();
  });

  test('grouped mode preserves the additional root through nested directories', async () => {
    const user = userEvent.setup();
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [makeFile('src/components/ui/dialog.tsx')],
        root: '/workspace/extra',
      },
      isLoading: false,
      error: null,
    });

    const onFileSelect = vi.fn();
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        root="/workspace/extra"
        mode="grouped"
        onFileSelect={onFileSelect}
      />,
    );

    await user.click(screen.getByText('src'));
    await user.click(screen.getByText('components'));
    await user.click(screen.getByText('ui'));
    await user.click(screen.getByText('dialog.tsx'));

    expect(onFileSelect).toHaveBeenCalledTimes(1);
    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.root).toBe('/workspace/extra');
    expect(target.entry.path).toBe('src/components/ui/dialog.tsx');
  });

  test('the target includes git metadata from the changed file', async () => {
    const user = userEvent.setup();
    const customGit: GitDiffSummary = {
      status: 'modified',
      staged: false,
      unstaged: true,
      additions: 3,
      deletions: 1,
    };
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [{ path: 'src/app.ts', git: customGit }],
        root: '',
      },
      isLoading: false,
      error: null,
    });

    const { onFileSelect } = renderWithRoot('');

    await user.click(screen.getByText('app.ts'));

    const target = onFileSelect.mock.calls[0]![0] as FileEntryActionTarget;
    expect(target.entry.git).toEqual(customGit);
  });
});

describe('GitChangesView - search', () => {
  beforeEach(() => {
    mockUseGitStatusQuery.mockReturnValue({
      data: {
        availability: { available: true },
        files: [
          makeFile('src/components/Dialog.tsx'),
          makeFile('src/app.ts'),
          makeFile('README.md'),
        ],
        root: '',
      },
      isLoading: false,
      error: null,
    });
  });

  test('filters paths case-insensitively and expands grouped matches', () => {
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        mode="grouped"
        searchQuery="DIALOG"
        onFileSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('components')).toBeInTheDocument();
    expect(screen.getByText('Dialog.tsx')).toBeInTheDocument();
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  test('preserves flat mode while filtering', () => {
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        mode="flat"
        searchQuery="src/"
        onFileSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Dialog.tsx')).toBeInTheDocument();
    expect(screen.getByText('app.ts')).toBeInTheDocument();
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();
  });

  test('distinguishes no matches from no changes', () => {
    render(
      <GitChangesView
        workspaceId="ws-1"
        sdkClient={null}
        mode="grouped"
        searchQuery="missing"
        onFileSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('No matching files')).toBeInTheDocument();
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
  });
});
