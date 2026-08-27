import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppWindow, Columns2, GripVertical, X } from 'lucide-react';
import { useAskStore } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useBoardFocus } from '@/hooks/useBoardFocus';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';
import { cn } from '@/lib/utils';
import { SessionStatusDot } from './SessionStatusDot';

export interface BoardTabStripProps {
  openSessionIds: string[];
  focusedSessionId: string;
  /** False when the container is too narrow for even two grid columns. */
  boardAvailable: boolean;
}

/**
 * Session tab strip shown above panes whenever more than one session is open,
 * in both tabs and board mode.
 *
 * - Click a tab to focus that session (store + URL stay in sync).
 * - Grip drag reorders panes; order applies to tabs and the board grid alike.
 * - Close removes the session from the board.
 * - The trailing toggle switches between tabs and board layout; board is
 *   disabled when the container cannot fit two grid columns. The choice is
 *   persisted as the board layout preference.
 */
export function BoardTabStrip({
  openSessionIds,
  focusedSessionId,
  boardAvailable,
}: BoardTabStripProps) {
  const focusBoard = useBoardFocus();
  const removeFromBoard = useSessionBoardStore(s => s.removeFromBoard);

  return (
    <div className="flex min-h-0 shrink-0 items-stretch gap-1 border-b border-border/40 px-1.5 py-1">
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto board-tab-strip-scrollbar"
        role="tablist"
        aria-label="Open sessions"
      >
        {openSessionIds.map((sessionId) => (
          <BoardTab
            key={sessionId}
            sessionId={sessionId}
            isActive={sessionId === focusedSessionId}
            onFocus={() => focusBoard(sessionId)}
            onRemove={() => removeFromBoard(sessionId)}
          />
        ))}
      </div>
      <BoardLayoutToggle boardAvailable={boardAvailable} />
    </div>
  );
}

interface BoardTabProps {
  sessionId: string;
  isActive: boolean;
  onFocus: () => void;
  onRemove: () => void;
}

function BoardTab({ sessionId, isActive, onFocus, onRemove }: BoardTabProps) {
  const session = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId));
  const workspaceNameById = useWorkspaceNameById();
  const askCount = useAskStore(
    (s) => s.pendingRequests.filter(
      (r) => r.sessionId === sessionId || r.originSessionId === sessionId,
    ).length,
  );

  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sessionId });

  const wsName = session?.workspaceId ? workspaceNameById.get(session.workspaceId) : undefined;
  const label = wsName ? `${wsName} / ${session?.title || 'Untitled'}` : (session?.title || 'Untitled');

  return (
    <div
      ref={setNodeRef}
      role="tab"
      aria-selected={isActive}
      className={cn(
        'group/board-tab flex h-7 shrink-0 items-center gap-1.5 rounded-md pl-1 pr-2 text-xs transition-colors',
        isActive
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
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
        className="flex size-4 shrink-0 cursor-grab touch-none items-center justify-center opacity-0 transition-opacity group-hover/board-tab:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
        onMouseDown={(event) => event.stopPropagation()}
        title={`Reorder ${label}`}
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3" />
      </button>
      <SessionStatusDot sessionId={sessionId} />
      <button
        type="button"
        onClick={onFocus}
        className="max-w-56 truncate py-0.5"
        title={label}
      >
        {label}
      </button>
      {askCount > 0 && (
        <span
          className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          title={askCount === 1 ? '1 pending permission request' : `${askCount} pending permission requests`}
        >
          {askCount}
        </span>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-60 hover:bg-background hover:opacity-100 focus-visible:opacity-100"
        title={`Remove ${label} from board`}
        aria-label={`Remove ${label} from board`}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function useWorkspaceNameById(): Map<string, string> {
  const workspaces = useServerDataStore(s => s.workspaces);
  const agents = useServerDataStore(s => s.agents);

  const map = new Map<string, string>();
  for (const workspace of workspaces) {
    map.set(workspace.id, getWorkspaceDisplayName(workspace, agents));
  }
  return map;
}

function BoardLayoutToggle({ boardAvailable }: { boardAvailable: boolean }) {
  const layoutMode = useSessionBoardStore(s => s.layoutMode);
  const setLayoutMode = useSessionBoardStore(s => s.setLayoutMode);
  const boardActive = layoutMode === 'board';
  const tabsActive = layoutMode === 'tabs';

  // Segmented control matching the header's Workspace/Overview toggle:
  // the active segment lifts out of the muted track (bg-background + shadow),
  // so selection stays obvious even while the board segment is disabled.
  return (
    <div
      className="flex shrink-0 items-center rounded-lg bg-muted p-0.5"
      role="group"
      aria-label="Board layout"
    >
      <button
        type="button"
        onClick={() => { if (!tabsActive) setLayoutMode('tabs'); }}
        aria-pressed={tabsActive}
        aria-label="Tabs"
        title="Tabs"
        className={cn(
          'flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          tabsActive
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <AppWindow className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => { if (boardAvailable && !boardActive) setLayoutMode('board'); }}
        aria-pressed={boardActive}
        aria-label="Board"
        disabled={!boardAvailable}
        title={boardAvailable ? 'Board' : 'Board layout needs more width'}
        className={cn(
          'flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          boardActive
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
          !boardAvailable && 'cursor-not-allowed opacity-40',
        )}
      >
        <Columns2 className="size-3.5" />
      </button>
    </div>
  );
}
