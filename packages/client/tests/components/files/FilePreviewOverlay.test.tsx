import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ProkopaiClient, ServerError } from '@prokopai/sdk';
import FilePreviewOverlay from '@/components/files/FilePreviewOverlay';
import type { FilePreviewTarget } from '@/stores/uiStore';

vi.mock('@prokopai/sdk', () => ({
  ProkopaiClient: vi.fn(),
  ServerError: class MockServerError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = 'ServerError';
      this.statusCode = statusCode;
    }
  },
}));

// Pierre renders into shadow DOM, so light-DOM text assertions cannot see
// file content; mock the code views to keep behavioral assertions meaningful.
vi.mock('@/components/files/FileCodeView', () => ({
  FileCodeView: ({
    content,
    diff,
  }: {
    content: string;
    diff?: { hunks: { changes: { content: string }[] }[] };
  }) => (
    <div data-testid="mock-file-code-view">
      {content.split('\n').map((line, i) => (
        <div key={`content-${i}`}>{line}</div>
      ))}
      {diff?.hunks.flatMap((hunk) => hunk.changes).map((change, i) => (
        <div key={`change-${i}`}>{change.content}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/files/FilePreviewCodeView', () => ({
  default: () => <div data-testid="mock-file-preview-code-view" />,
}));

const mockPreviewFn = vi.fn();
const mockGitDiffFn = vi.fn();

function makeSdkClient(): ProkopaiClient {
  return {
    http: {
      files: {
        preview: mockPreviewFn,
        gitDiff: mockGitDiffFn,
      },
    },
  } as unknown as ProkopaiClient;
}

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderOverlay(
  client: QueryClient,
  overrides?: Partial<React.ComponentProps<typeof FilePreviewOverlay>>,
) {
  const target: FilePreviewTarget = {
    workspaceId: 'ws-1',
    path: '/src/app.ts',
    name: 'app.ts',
  };
  return render(
    <FilePreviewOverlay
      workspaceId="ws-1"
      target={target}
      sdkClient={makeSdkClient()}
      open={true}
      onOpenChange={vi.fn()}
      {...overrides}
    />,
    { wrapper: makeWrapper(client) },
  );
}

describe('FilePreviewOverlay - scroll stability', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    mockPreviewFn.mockReset();
    mockGitDiffFn.mockReset();
  });

  test('shows spinner during initial load', async () => {
    mockPreviewFn.mockReturnValue(new Promise(() => {}));
    mockGitDiffFn.mockResolvedValue({ diffAvailable: false });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByRole('status', { hidden: true }) || document.querySelector('.animate-spin')).toBeTruthy();
    });
  });

  test('renders content after initial load and keeps it mounted during refresh', async () => {
    const initialContent = 'line1\nline2\nline3';
    mockPreviewFn.mockResolvedValue({
      kind: 'code',
      content: initialContent,
      language: 'typescript',
      size: 18,
    });
    mockGitDiffFn.mockResolvedValue({ diffAvailable: false });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('line1')).toBeInTheDocument();
    });

    const contentBefore = screen.queryByText('line1');
    expect(contentBefore).not.toBeNull();

    mockPreviewFn.mockResolvedValue({
      kind: 'code',
      content: 'updated1\nupdated2\nupdated3',
      language: 'typescript',
      size: 27,
    });

    const refreshButtons = screen.getAllByRole('button');
    const refreshBtn = refreshButtons.find((b) => b.querySelector('[class*="refresh" i]') || b.getAttribute('title') === 'Refresh' || b.classList.toString().includes('right-12'));
    await act(async () => {
      if (refreshBtn) await userEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('updated1')).toBeInTheDocument();
    });

    expect(screen.queryByText('line1')).not.toBeInTheDocument();
  });

  test('refresh button is disabled while refreshing', async () => {
    mockPreviewFn.mockResolvedValue({
      kind: 'code',
      content: 'hello',
      language: 'typescript',
      size: 5,
    });
    mockGitDiffFn.mockResolvedValue({ diffAvailable: false });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
    });

    mockPreviewFn.mockReturnValue(new Promise(() => {}));

    const refreshButtons = screen.getAllByRole('button');
    const refreshBtn = refreshButtons.find((b) => b.getAttribute('title') === 'Refresh file');
    expect(refreshBtn).toBeTruthy();
    await act(async () => {
      if (refreshBtn) await userEvent.click(refreshBtn);
    });

    await waitFor(() => {
      expect(refreshBtn).toBeDisabled();
    });
  });

  test('retry button appears on initial load error', async () => {
    mockPreviewFn.mockRejectedValue(new Error('Network error'));
    mockGitDiffFn.mockResolvedValue({ diffAvailable: false });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 5: deleted-file Preview detection. A modified diff with deletions
// must NOT be treated as a deleted file when the preview merely errors.
// Only explicit `deleted` git status or a confirmed file-not-found with a
// deletion diff renders the deletion-only state.
// ---------------------------------------------------------------------------

function deletionDiffResponse() {
  return {
    diffAvailable: true,
    additions: 0,
    deletions: 5,
    hunks: [
      {
        oldStart: 1,
        oldLines: 5,
        newStart: 1,
        newLines: 0,
        changes: [
          { type: 'removed', content: 'gone1' },
          { type: 'removed', content: 'gone2' },
        ],
      },
    ],
    status: { status: 'modified', staged: false, unstaged: true, additions: 0, deletions: 5 },
  };
}

describe('FilePreviewOverlay - deleted-file detection', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    mockPreviewFn.mockReset();
    mockGitDiffFn.mockReset();
  });

  test('a modified diff with deletions plus an ordinary error keeps Retry and is not marked deleted', async () => {
    mockPreviewFn.mockRejectedValue(new Error('Something went wrong'));
    mockGitDiffFn.mockResolvedValue(deletionDiffResponse());

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    // Must NOT render the deletion-only state
    expect(screen.queryByText(/This file was deleted/)).not.toBeInTheDocument();
    expect(screen.queryByText('deleted')).not.toBeInTheDocument();
    // The real error message should be shown instead
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  test('a modified diff with deletions plus a network (ConnectionError-like) failure keeps Retry', async () => {
    mockPreviewFn.mockRejectedValue(new Error('Network error'));
    mockGitDiffFn.mockResolvedValue(deletionDiffResponse());

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    expect(screen.queryByText(/This file was deleted/)).not.toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  test('a non-404 server error with deletions keeps Retry and is not deleted', async () => {
    // A 500 server error is not a file-not-found, so even with deletions the
    // file must not be classified as deleted.
    mockPreviewFn.mockRejectedValue(new ServerError('Internal server error', 500));
    mockGitDiffFn.mockResolvedValue(deletionDiffResponse());

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    expect(screen.queryByText(/This file was deleted/)).not.toBeInTheDocument();
    expect(screen.getByText('Internal server error')).toBeInTheDocument();
  });

  test('explicit deleted git status renders the deletion diff despite preview failure', async () => {
    mockPreviewFn.mockRejectedValue(new ServerError('File not found', 404));
    mockGitDiffFn.mockResolvedValue({
      diffAvailable: true,
      additions: 0,
      deletions: 3,
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 0,
          changes: [{ type: 'removed', content: 'deleted line' }],
        },
      ],
      status: { status: 'deleted', staged: false, unstaged: true, additions: 0, deletions: 3 },
    });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText(/This file was deleted/)).toBeInTheDocument();
    });

    // The deletion diff content is rendered
    expect(screen.getByText('deleted line')).toBeInTheDocument();
    // Retry must NOT be shown for the confirmed deleted-file state
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  test('deleted status with deletions shows the deletion header and totals', async () => {
    mockPreviewFn.mockRejectedValue(new ServerError('File not found', 404));
    mockGitDiffFn.mockResolvedValue({
      diffAvailable: true,
      additions: 0,
      deletions: 7,
      hunks: [
        {
          oldStart: 1,
          oldLines: 7,
          newStart: 1,
          newLines: 0,
          changes: [{ type: 'removed', content: 'removed content' }],
        },
      ],
      status: { status: 'deleted', staged: false, unstaged: true, additions: 0, deletions: 7 },
    });

    renderOverlay(queryClient);

    await waitFor(() => {
      expect(screen.getByText('deleted')).toBeInTheDocument();
    });

    // Deletion total badge is present
    expect(screen.getByText('-7')).toBeInTheDocument();
    // Showing the deletion diff
    expect(screen.getByText('removed content')).toBeInTheDocument();
  });
});

