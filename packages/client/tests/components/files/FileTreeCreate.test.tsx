import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProkopaiClient } from '@prokopai/sdk';

const mockUseFileTreeFullQuery = vi.fn();
const mockUseGitStatusQuery = vi.fn();

vi.mock('@/hooks/queries/useFileTreeFullQuery', () => ({
  useFileTreeFullQuery: (...args: unknown[]) => mockUseFileTreeFullQuery(...args),
}));

vi.mock('@/hooks/queries/useFileQueries', () => ({
  useGitStatusQuery: (...args: unknown[]) => mockUseGitStatusQuery(...args),
}));

import { FileTree, type FileTreeHandle } from '@/components/files/FileTreePierre';

function makeSdk(paths: string[] = []) {
  mockUseFileTreeFullQueryReturnValue(paths);
  mockUseGitStatusQueryReturnValue([]);
  return {
    http: {
      files: {
        tree: vi.fn(),
        createFile: vi.fn().mockResolvedValue({ path: 'test.ts' }),
      },
    },
  } as unknown as ProkopaiClient;
}

function mockUseFileTreeFullQueryReturnValue(paths: string[]) {
  mockUseFileTreeFullQuery.mockReturnValue({
    data: { root: '/w', isMain: true, paths, truncated: false },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

function mockUseGitStatusQueryReturnValue(_files: unknown[]) {
  mockUseGitStatusQuery.mockReturnValue({
    data: { availability: { available: true }, files: [] },
    isLoading: false,
    error: null,
  });
}

describe('FileTree create flow (empty workspace)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('openCreateAtRoot opens the dialog and submitting calls createFile at the root', async () => {
    const sdk = makeSdk([]);
    const user = userEvent.setup();
    const ref = { current: null as FileTreeHandle | null };

    render(
      <FileTree
        ref={ref as never}
        workspaceId="ws-1"
        sdkClient={sdk}
        serverId="s1"
        onOpenFileEdit={vi.fn()}
      />,
    );

    // Sanity: the tree mounted (empty workspace = no rows, no error state).
    expect(screen.queryByText('Loading files...')).toBeNull();

    // The + button entry point.
    act(() => {
      ref.current?.openCreateAtRoot('file');
    });

    const input = await screen.findByLabelText(/file name/i);
    expect(input).toBeInTheDocument();

    await user.type(input, 'test.ts');
    await user.click(screen.getByRole('button', { name: 'Create File' }));

    await waitFor(() => {
      expect(sdk.http.files.createFile).toHaveBeenCalledWith('ws-1', {
        path: 'test.ts',
        kind: 'file',
        root: undefined,
        createParents: true,
      });
    });
  });

  test('createFile failure surfaces the server message inside the dialog', async () => {
    const sdk = {
      http: {
        files: {
          createFile: vi.fn().mockRejectedValue(new Error('Entry already exists: test.ts')),
        },
      },
    } as unknown as ProkopaiClient;
    const user = userEvent.setup();
    const ref = { current: null as FileTreeHandle | null };

    render(
      <FileTree
        ref={ref as never}
        workspaceId="ws-1"
        sdkClient={sdk}
        serverId="s1"
        onOpenFileEdit={vi.fn()}
      />,
    );

    act(() => {
      ref.current?.openCreateAtRoot('file');
    });
    const input = await screen.findByLabelText(/file name/i);
    await user.type(input, 'test.ts');
    await user.click(screen.getByRole('button', { name: 'Create File' }));

    expect(await screen.findByText(/Entry already exists/i)).toBeInTheDocument();
  });
});
