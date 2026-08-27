import { useCallback, useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionBoardStore, serializeOpenSessionIds } from '@/stores/sessionBoardStore';
import { SessionPane } from './SessionPane';
import { useBoardSessionLoader } from '@/hooks/useBoardSessionLoader';
import { useConnectionStore } from '@/stores/connectionStore';
import { BoardTabStrip } from './BoardTabStrip';
import { cn } from '@/lib/utils';
import {
  getSessionBoardGridLayout,
  MIN_SESSION_PANE_WIDTH,
} from './sessionBoardLayout';

export interface SessionBoardProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
}

/**
 * Derive the viewPath from the current route.
 * Matches the logic in useBoardFocus and useServerSessionManager.
 */
function useViewPath(): string {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.includes('/overview')) return '/overview';
  return '/workspace';
}

export function SessionBoard({ sdkClient, serverUrl }: SessionBoardProps) {
  const { openSessionIds, focusedSessionId, layoutMode, removeFromBoard } = useSessionBoardStore();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const connected = useConnectionStore(s => s.connected);
  const navigate = useNavigate();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const serverId = params?.serverId as string | undefined;
  const viewPath = useViewPath();

  useBoardSessionLoader(sdkClient, connected);

  // Track only the derived column budget: during animated panel transitions the
  // raw width changes every frame, but the pane-width quotient almost never
  // does, so storing the derived integer lets React bail out instead of
  // re-rendering the whole board per animation frame.
  const [maxColumns, setMaxColumns] = useState(1);
  const observerRef = useRef<ResizeObserver | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (node) {
      setMaxColumns(Math.max(1, Math.floor(node.clientWidth / MIN_SESSION_PANE_WIDTH)) || 1);
      observerRef.current = new ResizeObserver((entries) => {
        const entry = entries.at(-1);
        if (!entry) return;
        const next = Math.max(
          1,
          Math.floor(entry.contentRect.width / MIN_SESSION_PANE_WIDTH),
        ) || 1;

        // ResizeObserver notifications and React layout changes must be split
        // across frames. A microtask still runs in the same observer delivery
        // cycle and can produce undelivered-notification errors.
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
        }
        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          setMaxColumns(prev => (prev === next ? prev : next));
        });
      });
      observerRef.current.observe(node);
    }
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  const visiblePaneCount = openSessionIds.length;
  const showPaneChrome = visiblePaneCount > 1 && layoutMode !== 'focused';
  const {
    showGrid,
    columnCount: gridColumnCount,
    rowCount: gridRowCount,
  } = getSessionBoardGridLayout(visiblePaneCount, maxColumns, layoutMode);

  const handleRemoveOthers = useCallback((exceptId: string) => {
    const board = useSessionBoardStore.getState();
    for (const id of board.openSessionIds) {
      if (id !== exceptId) board.removeFromBoard(id);
    }
    const state = useSessionBoardStore.getState();
    if (state.focusedSessionId) {
      navigate({
        to: `/server/$serverId${viewPath}/session/$sessionId`,
        params: { serverId: serverId!, sessionId: state.focusedSessionId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }, [navigate, serverId, viewPath]);

  const handleCloseAll = useCallback(() => {
    useSessionBoardStore.getState().clearBoard();
    navigate({
      to: `/server/$serverId${viewPath}`,
      params: { serverId: serverId! },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }, [navigate, serverId, viewPath]);

  const handleRemoveFromBoard = useCallback((sessionId: string) => {
    removeFromBoard(sessionId);
    const state = useSessionBoardStore.getState();
    if (state.focusedSessionId) {
      const open = serializeOpenSessionIds(state.openSessionIds.length > 1 ? state.openSessionIds : []);
      navigate({
        to: `/server/$serverId${viewPath}/session/$sessionId`,
        params: { serverId: serverId!, sessionId: state.focusedSessionId },
        ...(open ? { search: { open } as Record<string, unknown> } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } else {
      // No panes left: navigate to the current view root
      navigate({
        to: `/server/$serverId${viewPath}`,
        params: { serverId: serverId! },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
  }, [removeFromBoard, navigate, serverId, viewPath]);

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const board = useSessionBoardStore.getState();
    const targetIndex = board.openSessionIds.indexOf(String(over.id));
    if (targetIndex === -1) return;

    board.reorderSession(String(active.id), targetIndex);
    const state = useSessionBoardStore.getState();
    if (!state.focusedSessionId) return;

    const open = serializeOpenSessionIds(state.openSessionIds.length > 1 ? state.openSessionIds : []);
    navigate({
      to: `/server/$serverId${viewPath}/session/$sessionId`,
      params: { serverId: serverId!, sessionId: state.focusedSessionId },
      ...(open ? { search: { open } as Record<string, unknown> } : {}),
      replace: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }, [navigate, serverId, viewPath]);

  if (visiblePaneCount === 0) {
    return (
      <div className="flex min-w-0 max-w-full flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <h2 className="mb-2">Select or create a session</h2>
        <p>Choose a session from the sidebar or create a new one to start chatting.</p>
      </div>
    );
  }

  const renderPane = (sessionId: string, isCompact: boolean, withPaneMenu = true) => (
    <SortableSessionPane key={sessionId} sessionId={sessionId}>
      {(dragAttributes, dragListeners, setDragActivatorNode) => (
        <SessionPane
          sessionId={sessionId}
          sdkClient={sdkClient}
          serverUrl={serverUrl}
          isFocused={sessionId === focusedSessionId}
          isCompact={isCompact}
          showPaneChrome={showPaneChrome}
          onRemoveFromBoard={handleRemoveFromBoard}
          onCloseOthers={withPaneMenu && visiblePaneCount > 2 ? () => handleRemoveOthers(sessionId) : undefined}
          onCloseAll={withPaneMenu && visiblePaneCount > 1 ? handleCloseAll : undefined}
          dragAttributes={dragAttributes}
          dragListeners={dragListeners}
          setDragActivatorNode={setDragActivatorNode}
        />
      )}
    </SortableSessionPane>
  );

  // Board grid: every pane visible side by side, strip on top for focus and
  // reorder. The strip lives inside the board container so it observes the
  // same width budget that drives the column count.
  if (showGrid) {
    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={openSessionIds} strategy={rectSortingStrategy}>
          <div
            ref={containerRef}
            className="grid min-h-0 min-w-0 max-w-full flex-1 grid-rows-[auto_minmax(0,1fr)] gap-1.5 overflow-hidden p-1.5"
            // Explicit flexible column: without it the implicit column track is
            // `auto`, which sizes to the panes grid's max-content (unbounded:
            // chat code blocks do not wrap), overflowing and clipping instead
            // of clamping to the container.
            style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}
          >
            <BoardTabStrip
              openSessionIds={openSessionIds}
              focusedSessionId={focusedSessionId ?? openSessionIds[0]}
              boardAvailable={maxColumns > 1}
            />
            <div
              className="grid min-h-0 min-w-0 overflow-hidden"
              style={{
                gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridRowCount}, minmax(0, 1fr))`,
              }}
            >
              {openSessionIds.map(sessionId => renderPane(sessionId, false))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  // Tabs mode or a single focused pane: strip (when multiple sessions are
  // open) plus panes. In tabs mode every open pane stays mounted; hidden
  // panes keep their scroll position and streaming state, and permission UI
  // inside them reactivates the moment their tab is focused.
  const focusId = focusedSessionId ?? openSessionIds[0];
  const isTabsMode = layoutMode === 'tabs' && visiblePaneCount > 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={openSessionIds} strategy={horizontalListSortingStrategy}>
        <div ref={containerRef} className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          {visiblePaneCount > 1 && (
            <BoardTabStrip
              openSessionIds={openSessionIds}
              focusedSessionId={focusId}
              boardAvailable={maxColumns > 1}
            />
          )}
          {isTabsMode ? (
            <div className="relative min-h-0 min-w-0 flex-1">
              {openSessionIds.map(sessionId => (
                <div
                  key={sessionId}
                  className={cn(
                    'absolute inset-0',
                    sessionId === focusId ? 'flex flex-col' : 'invisible pointer-events-none',
                  )}
                  aria-hidden={sessionId !== focusId}
                  inert={sessionId !== focusId}
                >
                  {renderPane(sessionId, sessionId === focusId, false)}
                </div>
              ))}
            </div>
          ) : (
            renderPane(focusId, true, false)
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SortableSessionPaneProps {
  sessionId: string;
  children: (
    dragAttributes: DraggableAttributes,
    dragListeners: DraggableSyntheticListeners,
    setDragActivatorNode: (element: HTMLButtonElement | null) => void,
  ) => React.ReactNode;
}

function SortableSessionPane({ sessionId, children }: SortableSessionPaneProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sessionId });

  return (
    <div
      ref={setNodeRef}
      className="h-full min-h-0 min-w-0 max-w-full"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      {children(attributes, listeners, setActivatorNodeRef)}
    </div>
  );
}
