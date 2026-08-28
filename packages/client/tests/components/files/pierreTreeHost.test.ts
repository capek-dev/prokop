import { describe, expect, test, vi } from 'vitest';
import { activatePierreFileSelection } from '@/components/files/pierreTreeHost';

describe('activatePierreFileSelection', () => {
  test('activates a file and clears selection so the same row can activate again', () => {
    const activate = vi.fn();
    const deselect = vi.fn();
    const model = {
      getItem: () => ({
        isDirectory: () => false,
        deselect,
      }),
    };

    expect(activatePierreFileSelection(model, 'src/app.ts', activate)).toBe(true);
    expect(activatePierreFileSelection(model, 'src/app.ts', activate)).toBe(true);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(deselect).toHaveBeenCalledTimes(2);
  });

  test('does not activate directory rows', () => {
    const activate = vi.fn();
    const deselect = vi.fn();
    const model = {
      getItem: () => ({
        isDirectory: () => true,
        deselect,
      }),
    };

    expect(activatePierreFileSelection(model, 'src/', activate)).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(deselect).not.toHaveBeenCalled();
  });

  test('deselects a file row even without an activate callback', () => {
    // A stale files list (frozen selection closure) must not strand the row:
    // Pierre only emits onSelectionChange on change, so a stranded selection
    // swallows every later click on that row.
    const deselect = vi.fn();
    const model = {
      getItem: () => ({
        isDirectory: () => false,
        deselect,
      }),
    };

    expect(activatePierreFileSelection(model, 'src/app.ts')).toBe(true);
    expect(deselect).toHaveBeenCalledTimes(1);
  });
});
