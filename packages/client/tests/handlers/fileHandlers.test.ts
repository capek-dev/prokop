import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockInvalidate } = vi.hoisted(() => ({ mockInvalidate: vi.fn() }));

vi.mock('@/components/providers/QueryProvider', () => {
  return { queryClient: { invalidateQueries: mockInvalidate } };
});

import { handleFilesChanged } from '@/handlers/serverMessage/fileHandlers';

function invalidatedKeys(): readonly (readonly unknown[])[] {
  return mockInvalidate.mock.calls.map((c: unknown[]) => {
    const arg = c[0] as { queryKey: readonly unknown[] };
    return arg.queryKey;
  });
}

describe('handleFilesChanged', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockInvalidate.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    mockInvalidate.mockClear();
  });

  test('debounces a burst into one workspace-scoped batch', () => {
    handleFilesChanged('ws-1');
    handleFilesChanged('ws-1');
    handleFilesChanged('ws-1');
    expect(mockInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    // One batched set of file contents and listings. Git status, branch
    // views, and the file tree come from the server's feeds, not from tool
    // completions.
    expect(mockInvalidate).toHaveBeenCalledTimes(4);
    expect(invalidatedKeys()).toEqual([
      ['files', 'browse', 'ws-1'],
      ['files', 'search', 'ws-1'],
      ['files', 'git-diff', 'ws-1'],
      ['files', 'preview', 'ws-1'],
    ]);
  });

  test('workspaces debounce independently', () => {
    handleFilesChanged('ws-1');
    vi.advanceTimersByTime(200);
    handleFilesChanged('ws-2');
    vi.advanceTimersByTime(100);

    expect(mockInvalidate).toHaveBeenCalledTimes(4);
    const fileKeys = invalidatedKeys().filter(k => k[0] === 'files');
    expect(fileKeys.length).toBeGreaterThan(0);
    expect(fileKeys.every(k => k.at(-1) === 'ws-1')).toBe(true);

    vi.advanceTimersByTime(200);
    expect(mockInvalidate).toHaveBeenCalledTimes(8);
    expect(invalidatedKeys().some(k => k.at(-1) === 'ws-2')).toBe(true);
  });

  test('a later mutation restarts the debounce window', () => {
    handleFilesChanged('ws-1');
    vi.advanceTimersByTime(200);
    handleFilesChanged('ws-1');
    vi.advanceTimersByTime(200);
    expect(mockInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(mockInvalidate).toHaveBeenCalledTimes(4);
  });

  test('malformed workspace ids fail closed', () => {
    handleFilesChanged('');
    vi.advanceTimersByTime(300);
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
