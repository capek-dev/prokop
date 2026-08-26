import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
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
import { GripVertical } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionBoardStore, serializeOpenSessionIds } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { SessionPane } from './SessionPane';
import { useBoardSessionLoader } from '@/hooks/useBoardSessionLoader';
import { useConnectionStore } from '@/stores/connectionStore';
import { useBoardFocus } from '@/hooks/useBoardFocus';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';
import { cn } from '@/lib/utils';

export interface SessionBoardProps {
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
}

const MIN_PANE_WIDTH = 380;
const MAX_GRID_COLUMNS = 3;

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
  // raw width changes every frame, but floor(width/MIN_PANE_WIDTH) almost never
  // does, so storing the derived integer lets React bail out instead of
  // re-rendering the whole board per animation frame.
  const [maxColumns, setMaxColumns] = useState(1);
  const observerRef = useRef<ResizeObserver | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node) {
      setMaxColumns(Math.max(1, Math.floor(node.clientWidth / MIN_PANE_WIDTH)) || 1);
      observerRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const next = Math.max(1, Math.floor(entry.contentRect.width / MIN_PANE_WIDTH)) || 1;
          setMaxColumns(prev => (prev === next ? prev : next));
        }
      });
      observerRef.current.observe(node);
    }
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  const visiblePaneCount = openSessionIds.length;
  const showPaneChrome = visiblePaneCount > 1 && layoutMode === 'board';
  const gridColumnCount = Math.min(visiblePaneCount, MAX_GRID_COLUMNS);
  const gridRowCount = Math.ceil(visiblePaneCount / MAX_GRID_COLUMNS);

  // Render all panes when the columns required by the two-row layout fit.
  // Otherwise retain every open session and show only the focused pane.
  const showGrid =
    layoutMode === 'board' &&
    visiblePaneCount > 1 &&
    gridColumnCount <= maxColumns;

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

  const renderPane = (sessionId: string, isCompact: boolean) => (
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
          dragAttributes={dragAttributes}
          dragListeners={dragListeners}
          setDragActivatorNode={setDragActivatorNode}
        />
      )}
    </SortableSessionPane>
  );

  // Grid mode: all panes fit
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
            className="grid min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
            style={{
              gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${gridRowCount}, minmax(0, 1fr))`,
            }}
          >
            {openSessionIds.map(sessionId => renderPane(sessionId, false))}
          </div>
        </SortableContext>
      </DndContext>
    );
  }

  // Single focused pane (possibly with compact switcher)
  const focusId = focusedSessionId ?? openSessionIds[0];
  const showSwitcher = visiblePaneCount > 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={openSessionIds} strategy={horizontalListSortingStrategy}>
        <div ref={containerRef} className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
          {showSwitcher && (
            <CompactBoardSwitcher
              openSessionIds={openSessionIds}
              focusedSessionId={focusId}
            />
          )}
          {renderPane(focusId, true)}
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
      className="h-full min-h-0 min-w-0 max-w-full overflow-hidden"
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

/**
 * Compact board switcher shown when there are multiple open sessions
 * but not enough width to show them all side-by-side.
 */
function CompactBoardSwitcher({
  openSessionIds,
  focusedSessionId,
}: {
  openSessionIds: string[];
  focusedSessionId: string;
}) {
  const sessions = useSessionStore(s => s.sessions);
  const workspaces = useServerDataStore(s => s.workspaces);
  const agents = useServerDataStore(s => s.agents);
  const focusBoard = useBoardFocus();

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of workspaces) {
      map.set(workspace.id, getWorkspaceDisplayName(workspace, agents));
    }
    return map;
  }, [agents, workspaces]);

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border shrink-0 overflow-x-auto">
      {openSessionIds.map((sessionId) => {
        const session = sessions.find(s => s.id === sessionId);
        const isActive = sessionId === focusedSessionId;
        const wsName = session?.workspaceId ? workspaceNameById.get(session.workspaceId) : undefined;
        const label = wsName ? `${wsName} / ${session?.title || 'Untitled'}` : (session?.title || 'Untitled');
        return (
          <SortableCompactSession
            key={sessionId}
            sessionId={sessionId}
            label={label}
            isActive={isActive}
            onFocus={() => focusBoard(sessionId)}
          />
        );
      })}
    </div>
  );
}

interface SortableCompactSessionProps {
  sessionId: string;
  label: string;
  isActive: boolean;
  onFocus: () => void;
}

function SortableCompactSession({
  sessionId,
  label,
  isActive,
  onFocus,
}: SortableCompactSessionProps) {
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
      className={cn(
        'flex items-center rounded-md transition-colors',
        isActive
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-muted',
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        onMouseDown={(event) => event.stopPropagation()}
        title={`Reorder ${label}`}
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <button
        type="button"
        onClick={onFocus}
        className="py-0.5 pr-2 text-xs whitespace-nowrap"
        title={label}
      >
        {label}
      </button>
    </div>
  );
}
