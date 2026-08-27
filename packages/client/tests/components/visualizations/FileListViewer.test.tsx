import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FileListItem } from '@prokopai/sdk';
import { FileListViewer } from '@/components/visualizations/FileListViewer';

function makeFiles(count: number): FileListItem[] {
  return Array.from({ length: count }, (_, i) => ({ path: `src/file-${i}.ts` }));
}

function getToggle(container: HTMLElement): HTMLElement {
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
  if (!toggle) throw new Error('toggle not found');
  return toggle;
}

describe('FileListViewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when no groups or files', () => {
    const { container } = render(<FileListViewer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders flat file list inline when small', () => {
    const { container } = render(
      <FileListViewer files={[{ path: 'src/index.ts' }, { path: 'src/app.tsx' }]} />,
    );
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument();
    // Inline lists have no collapse toggle (copy buttons aside).
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
  });

  it('renders grouped files with labels', () => {
    render(
      <FileListViewer
        groups={[
          { label: 'Modified', files: [{ path: 'a.ts' }], icon: 'edit' },
          { label: 'Created', files: [{ path: 'b.ts' }], icon: 'plus' },
        ]}
      />,
    );
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('displays total count when provided', () => {
    render(<FileListViewer total={42} files={[{ path: 'a.ts' }]} />);
    expect(screen.getByText('42 files')).toBeInTheDocument();
  });

  it('uses custom labels for counts and copy actions', () => {
    render(
      <FileListViewer
        total={2}
        files={[{ path: 'Planning' }, { path: 'Review' }]}
        singularLabel="session"
        pluralLabel="sessions"
      />,
    );

    expect(screen.getByText('2 sessions')).toBeInTheDocument();
    expect(screen.getAllByTitle('Copy session').length).toBe(2);
  });

  it('shows file count per group', () => {
    render(
      <FileListViewer
        groups={[
          {
            label: 'Files',
            files: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
          },
        ]}
      />,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('displays line numbers', () => {
    render(<FileListViewer files={[{ path: 'main.ts', line: 42 }]} />);
    expect(screen.getByText(':42')).toBeInTheDocument();
  });

  it('does not show a line number when undefined', () => {
    render(<FileListViewer files={[{ path: 'main.ts' }]} />);
    expect(screen.queryByText(/^:\d+$/)).not.toBeInTheDocument();
  });

  it('shows action badges', () => {
    render(
      <FileListViewer
        files={[
          { path: 'new.ts', action: 'created' },
          { path: 'old.ts', action: 'modified' },
          { path: 'gone.ts', action: 'deleted' },
        ]}
      />,
    );
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
  });

  it('applies correct action styling', () => {
    render(
      <FileListViewer
        files={[
          { path: 'a.ts', action: 'created' },
          { path: 'b.ts', action: 'modified' },
          { path: 'c.ts', action: 'deleted' },
        ]}
      />,
    );

    expect(screen.getByText('created').className).toContain('text-success');
    expect(screen.getByText('modified').className).toContain('text-warning');
    expect(screen.getByText('deleted').className).toContain('text-destructive');
  });

  describe('collapsible large lists', () => {
    it('collapses lists above the inline budget to a single row', () => {
      const { container } = render(<FileListViewer title="src/**/*.ts" files={makeFiles(20)} />);

      const toggle = getToggle(container);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('20 files')).toBeInTheDocument();
      expect(screen.getByText('src/**/*.ts')).toBeInTheDocument();
      // Rows hidden while collapsed.
      expect(screen.queryByText('src/file-0.ts')).not.toBeInTheDocument();
    });

    it('expands and collapses on toggle click', () => {
      const { container } = render(<FileListViewer files={makeFiles(12)} />);

      fireEvent.click(getToggle(container));
      const toggle = getToggle(container);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('src/file-0.ts')).toBeInTheDocument();
      expect(screen.getByText('src/file-11.ts')).toBeInTheDocument();

      fireEvent.click(getToggle(container));
      expect(getToggle(container)).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('src/file-0.ts')).not.toBeInTheDocument();
    });

    it('reports server-side truncation when total exceeds provided items', () => {
      const { container } = render(
        <FileListViewer title="**/*" total={120} files={makeFiles(50)} />,
      );

      expect(screen.getByText('120 files')).toBeInTheDocument();
      expect(screen.getByText('first 50 shown')).toBeInTheDocument();

      fireEvent.click(getToggle(container));
      expect(
        screen.getByText('Showing first 50 of 120.'),
      ).toBeInTheDocument();
    });

    it('uses custom singular/plural labels on the collapsed header', () => {
      render(
        <FileListViewer
          total={30}
          files={makeFiles(9).map((f, i) => ({ ...f, path: `plan-${i}` }))}
          singularLabel="match"
          pluralLabel="matches"
        />,
      );

      expect(screen.getByText('30 matches')).toBeInTheDocument();
    });
  });

  describe('copy', () => {
    it('copies path to clipboard on copy button click', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });

      render(<FileListViewer files={[{ path: 'src/test.ts' }]} />);

      fireEvent.click(screen.getByTitle('Copy path'));
      expect(writeText).toHaveBeenCalledWith('src/test.ts');
    });

    it('shows confirmation after copying', async () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      });

      const { container } = render(<FileListViewer files={[{ path: 'a.ts' }]} />);

      fireEvent.click(screen.getByTitle('Copy path'));
      // Copied state swaps the copy icon for a success check.
      await vi.waitFor(() => {
        const copyBtn = screen.getByTitle('Copy path');
        expect(copyBtn.querySelector('.lucide-check')).not.toBeNull();
        expect(container).toBeDefined();
      });
    });
  });
});
