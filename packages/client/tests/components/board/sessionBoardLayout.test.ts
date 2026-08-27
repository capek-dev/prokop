import { describe, expect, test } from 'vitest';
import { getSessionBoardGridLayout } from '@/components/board/sessionBoardLayout';

describe('getSessionBoardGridLayout', () => {
  test('uses the number of columns that fit instead of collapsing three sessions to tabs', () => {
    expect(getSessionBoardGridLayout(3, 2, 'board')).toEqual({
      showGrid: true,
      columnCount: 2,
      rowCount: 2,
    });
  });

  test('uses compact mode when only one pane width fits', () => {
    expect(getSessionBoardGridLayout(3, 1, 'board')).toEqual({
      showGrid: false,
      columnCount: 1,
      rowCount: 1,
    });
  });

  test('keeps explicit focused mode compact on wide screens', () => {
    expect(getSessionBoardGridLayout(3, 3, 'focused')).toEqual({
      showGrid: false,
      columnCount: 3,
      rowCount: 1,
    });
  });
});
