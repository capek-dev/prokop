import type { LayoutMode } from '@/stores/sessionBoardStore';

export const MIN_SESSION_PANE_WIDTH = 380;
export const MAX_SESSION_GRID_COLUMNS = 3;

export interface SessionBoardGridLayout {
  showGrid: boolean;
  columnCount: number;
  rowCount: number;
}

export function getSessionBoardGridLayout(
  visiblePaneCount: number,
  maxColumns: number,
  layoutMode: LayoutMode,
): SessionBoardGridLayout {
  const columnCount = Math.min(
    visiblePaneCount,
    MAX_SESSION_GRID_COLUMNS,
    Math.max(1, maxColumns),
  );
  const showGrid =
    layoutMode === 'board' &&
    visiblePaneCount > 1 &&
    columnCount > 1;

  return {
    showGrid,
    columnCount,
    rowCount: showGrid ? Math.ceil(visiblePaneCount / columnCount) : 1,
  };
}
