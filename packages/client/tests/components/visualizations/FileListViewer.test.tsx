import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import type { FileListItem } from '@prokopai/sdk';
import { FileListViewer } from '@/components/visualizations/FileListViewer';

describe('FileListViewer', () => {
  it('renders nothing when no groups or files', () => {
    const { container } = render(<FileListViewer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders flat file list', () => {
    const files: FileListItem[] = [
      { path: 'src/index.ts' },
      { path: 'src/app.tsx' },
    ];
    render(<FileListViewer files={files} />);
    expect(screen.getByText('src/index.ts')).toBeInTheDocument();
    expect(screen.getByText('src/app.tsx')).toBeInTheDocument();
  });

  it('renders grouped files with labels', () => {
    render(
      <FileListViewer
        groups={[
          {
            label: 'Modified',
            files: [{ path: 'a.ts' }],
            icon: 'edit',
          },
          {
            label: 'Created',
            files: [{ path: 'b.ts' }],
            icon: 'plus',
          },
        ]}
      />,
    );
    expect(screen.getByText('Modified')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('displays title when provided', () => {
    render(
      <FileListViewer title="Changed Files" files={[{ path: 'x.ts' }]} />,
    );
    expect(screen.getByText('Changed Files')).toBeInTheDocument();
  });

  it('displays total count when provided', () => {
    render(
      <FileListViewer
        title="Files"
        total={42}
        files={[{ path: 'a.ts' }]}
      />,
    );
    expect(screen.getByText('(42 files)')).toBeInTheDocument();
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
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('displays line numbers', () => {
    render(
      <FileListViewer files={[{ path: 'main.ts', line: 42 }]} />,
    );
    expect(screen.getByText(':42')).toBeInTheDocument();
  });

  it('does not show line number when undefined', () => {
    const { container } = render(
      <FileListViewer files={[{ path: 'main.ts' }]} />,
    );
    const lineElements = container.querySelectorAll('.text-muted-foreground.shrink-0');
    const hasLineNumber = Array.from(lineElements).some(
      el => el.textContent?.startsWith(':'),
    );
    expect(hasLineNumber).toBe(false);
  });

  it('shows action badges', () => {
    const files: FileListItem[] = [
      { path: 'new.ts', action: 'created' },
      { path: 'old.ts', action: 'modified' },
      { path: 'gone.ts', action: 'deleted' },
    ];
    render(<FileListViewer files={files} />);
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
  });

  it('applies correct action styling', () => {
    const files: FileListItem[] = [
      { path: 'a.ts', action: 'created' },
      { path: 'b.ts', action: 'modified' },
      { path: 'c.ts', action: 'deleted' },
    ];
    render(<FileListViewer files={files} />);
    const createdBadge = screen.getByText('created');
    const modifiedBadge = screen.getByText('modified');
    const deletedBadge = screen.getByText('deleted');

    expect(createdBadge.className).toContain('text-success');
    expect(modifiedBadge.className).toContain('text-warning');
    expect(deletedBadge.className).toContain('text-destructive');
  });

  it('copies path to clipboard on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: { writeText },
    });

    render(<FileListViewer files={[{ path: 'src/test.ts' }]} />);

    const copyBtn = screen.getByTitle('Copy path');
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('src/test.ts');
    vi.restoreAllMocks();
  });

  it('shows "Copied!" after clicking copy button', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    render(<FileListViewer files={[{ path: 'a.ts' }]} />);

    const copyBtn = screen.getByTitle('Copy path');
    await userEvent.click(copyBtn);

    expect(screen.getByText('Copied!')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
