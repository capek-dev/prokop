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
});
