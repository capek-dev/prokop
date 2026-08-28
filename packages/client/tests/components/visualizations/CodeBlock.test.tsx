import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { CodeBlock } from '@/components/visualizations/CodeBlock';

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
// mock surfaces file contents and the selection range as attributes so the
// truncation and highlight mapping stay assertable.
vi.mock('@pierre/diffs/react', () => ({
  File: ({
    file,
    selectedLines,
  }: {
    file: { contents: string };
    selectedLines: { start: number; end: number } | null;
  }) => (
    <div
      data-testid="pierre-file"
      data-selected={selectedLines ? `${selectedLines.start}-${selectedLines.end}` : 'none'}
    >
      {file.contents}
    </div>
  ),
}));

function makeContent(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n');
}

async function collapseCurrent() {
  const expandBtn = screen.getAllByRole('button')[0];
  await userEvent.click(expandBtn);
}

describe('CodeBlock', () => {
  it('renders file path in header', () => {
    render(<CodeBlock content="hello" path="src/main.ts" />);
    expect(screen.getByText('src/main.ts')).toBeInTheDocument();
  });

  it('renders code content via text match', () => {
    render(<CodeBlock content="console.log" path="src/render.ts" />);
    expect(screen.getByTestId('pierre-file').textContent).toContain('console.log');
  });

  it('shows "Created" badge by default', () => {
    render(<CodeBlock content="hello" path="src/created.ts" />);
    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows "Overwrote" badge when created is false', () => {
    render(<CodeBlock content="hello" path="src/overwrote.ts" created={false} />);
    expect(screen.getByText('Overwrote')).toBeInTheDocument();
  });

  it('is expanded by default and shows full content', () => {
    const content = makeContent(30);
    render(<CodeBlock content={content} path="src/default-open.ts" />);
    expect(screen.queryByText('30 lines')).not.toBeInTheDocument();
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
  });

  it('shows line count when collapsed', async () => {
    const content = makeContent(30);
    render(<CodeBlock content={content} path="src/collapsed-count.ts" />);
    await collapseCurrent();
    expect(screen.getByText('30 lines')).toBeInTheDocument();
  });

  it('truncates the preview to the budget when collapsed', async () => {
    const content = makeContent(30);
    render(<CodeBlock content={content} path="src/collapsed-truncate.ts" />);
    await collapseCurrent();
    const fileEl = screen.getByTestId('pierre-file');
    expect(fileEl.textContent).toContain('line 20');
    expect(fileEl.textContent).not.toContain('line 21');
  });

  it('has file path button with title', () => {
    render(<CodeBlock content="hello" path="src/title.ts" />);
    const pathButton = screen.getByTitle('src/title.ts');
    expect(pathButton).toBeInTheDocument();
  });

  it('expands again after collapsing', async () => {
    const content = makeContent(30);
    render(<CodeBlock content={content} path="src/toggle.ts" />);
    await collapseCurrent();
    expect(screen.getByText('30 lines')).toBeInTheDocument();

    const expandBtn = screen.getAllByRole('button')[0];
    await userEvent.click(expandBtn);

    expect(screen.queryByText('30 lines')).not.toBeInTheDocument();
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
  });

  it('keeps expansion state across remounts (virtualizer recycling)', async () => {
    const content = makeContent(30);
    const path = 'src/persist.ts';
    const { unmount } = render(<CodeBlock content={content} path={path} />);
    await collapseCurrent();
    unmount();

    // Remount (fresh component instance): the collapsed choice must hold.
    render(<CodeBlock content={content} path={path} />);
    expect(screen.getByText('30 lines')).toBeInTheDocument();
  });

  it('scopes expansion state by vizKey, not path+length', async () => {
    const content = makeContent(30);
    const path = 'src/shared.ts';

    // Tool call A (vizKey a): user collapses it.
    const { unmount } = render(<CodeBlock content={content} path={path} vizKey="part-a" />);
    await collapseCurrent();
    expect(screen.getByText('30 lines')).toBeInTheDocument();
    unmount();

    // Tool call B: same path, same content, different part id → must be open.
    render(<CodeBlock content={content} path={path} vizKey="part-b" />);
    expect(screen.queryByText('30 lines')).not.toBeInTheDocument();
    expect(screen.getByTestId('pierre-file').textContent).toContain('line 30');
  });

  it('maps highlightLines onto the selection range', () => {
    render(
      <CodeBlock content={'line1\nline2\nline3'} path="src/highlight.ts" highlightLines={[2]} />,
    );
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', '2-2');
  });

  it('clamps the selection to the collapsed preview length', async () => {
    const content = makeContent(30);
    render(<CodeBlock content={content} path="src/clamp.ts" highlightLines={[25]} />);
    await collapseCurrent();
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', '20-20');
  });

  it('passes no selection when highlightLines is empty', () => {
    render(<CodeBlock content="hello" path="src/noselect.ts" />);
    expect(screen.getByTestId('pierre-file')).toHaveAttribute('data-selected', 'none');
  });
});
