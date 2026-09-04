import { ChevronRight, MoreHorizontal, RotateCcw, Trash2, X, Loader2, Pencil, CheckSquare, Square, Tag, Plus, XIcon, Sparkles, Columns2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import React from 'react';
import type { Session } from '@prokopai/sdk';
import {
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useCompletionStore, selectCompletionRecord, COMPLETION_FLASH_DURATION_MS } from '@/stores/completionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { useWorktreesQuery } from '@/hooks/queries';
import { getSessionWorktreeLabel, resolveSessionWorktree } from '@/lib/sessionWorktree';

export type ChildrenMap = Map<string, Session[]>;

export type SessionDerivedValuesMap = Map<string, {
  isStreaming: boolean;
  hasPendingPermission: boolean;
  isRunning: boolean;
}>;

interface SessionMenuButtonProps {
  session: Session;
  childrenMap: ChildrenMap;
  sessionDerivedValues: SessionDerivedValuesMap;
  isActive: boolean;
  currentSessionId: string | null;
  onResumeSession: (sessionId: string) => void;
  onOpenAlongside?: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onReopenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onRegenerateTitle?: (sessionId: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (sessionId: string) => void;
  allWorkspaceTags?: string[];
  onAddTag?: (sessionId: string, tag: string) => void;
  onRemoveTag?: (sessionId: string, tag: string) => void;
}

const SessionActionsDropdown = React.memo(function SessionActionsDropdown({
  isClosed,
  isEditing,
  selectionMode,
  onRename,
  onRegenerateTitle,
  onReopen,
  onClose,
  onDelete,
  sessionTags,
  allWorkspaceTags,
  onAddTag,
  onRemoveTag,
  sessionId,
  onOpenAlongside,
}: {
  isClosed: boolean;
  isEditing: boolean;
  selectionMode?: boolean;
  onRename: () => void;
  onRegenerateTitle?: () => void;
  onReopen: () => void;
  onClose: () => void;
  onDelete: () => void;
  sessionTags: string[];
  allWorkspaceTags?: string[];
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  sessionId: string;
  onOpenAlongside?: () => void;
}) {
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const tagInputRef = useRef<HTMLInputElement>(null);

  const isDeleting = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'delete'),
  );
  const isRegeneratingTitle = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'regenerate_title'),
  );

  useEffect(() => {
    if (tagInputOpen && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [tagInputOpen]);

  const filteredSuggestions = allWorkspaceTags?.filter(
    t => t.toLowerCase().includes(tagInput.toLowerCase()) && !sessionTags.includes(t),
  ) ?? [];

  if (isEditing) return <div className="shrink-0 size-7" />;

  if (selectionMode) return <div className="shrink-0 size-7" />;

  const toggleTagInput = (e: React.MouseEvent) => {
    e.preventDefault();
    setTagInputOpen((prev) => !prev);
  };

  const preventClose = (e: Event) => {
    e.preventDefault();
  };

  const commitTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && onAddTag) {
      onAddTag(trimmed);
      setTagInput('');
      setTagInputOpen(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover className="top-1/2 -translate-y-1/2">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Session actions</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {onOpenAlongside && (
          <DropdownMenuItem onClick={onOpenAlongside}>
            <Columns2 className="size-4" />
            Open alongside
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onRename}>
          <Pencil className="size-4" />
          Rename
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onRegenerateTitle} disabled={!onRegenerateTitle || isRegeneratingTitle}>
          {isRegeneratingTitle ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {isRegeneratingTitle ? 'Generating...' : 'Regenerate title'}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {sessionTags.length > 0 && onRemoveTag ? (
          <>
            <DropdownMenuItem onClick={() => onRemoveTag(sessionTags[0])}>
              <XIcon className="size-4" />
              Remove tag
              <span className="ml-auto text-xs text-muted-foreground">{sessionTags[0]}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTagInput} onSelect={preventClose}>
              <Tag className="size-4" />
              Change tag
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={toggleTagInput} onSelect={preventClose}>
            <Tag className="size-4" />
            Add tag
          </DropdownMenuItem>
        )}
        {tagInputOpen && (
          <div
            className="px-2 py-1.5"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1">
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitTag();
                  } else if (e.key === 'Escape') {
                    setTagInputOpen(false);
                    setTagInput('');
                  }
                }}
                placeholder="Tag name..."
                className="flex-1 min-w-0 h-6 px-2 text-xs bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={commitTag}
                className="p-0.5 hover:bg-accent rounded"
              >
                <Plus className="size-3" />
              </button>
            </div>
            {tagInput && filteredSuggestions.length > 0 && (
              <div className="mt-1 max-h-24 overflow-y-auto">
                {filteredSuggestions.slice(0, 5).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      if (onAddTag) {
                        onAddTag(suggestion);
                        setTagInput('');
                        setTagInputOpen(false);
                      }
                    }}
                    className="w-full text-left text-xs px-2 py-1 hover:bg-accent rounded"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <DropdownMenuSeparator />

        {isClosed ? (
          <>
            <DropdownMenuItem onClick={onReopen}>
              <RotateCcw className="size-4" />
              Restore
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              disabled={isDeleting}
              className="text-destructive focus:text-destructive"
            >
              {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {isDeleting ? 'Deleting...' : 'Delete permanently'}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onClick={onClose}>
            <X className="size-4" />
            Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

type SessionDotState = 'running' | 'error' | 'interrupted' | 'warning' | 'idle';

const SessionStatusDot = React.memo(function SessionStatusDot({ state }: { state: SessionDotState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        state === 'running' && 'animate-pulse bg-primary',
        state === 'error' && 'bg-destructive',
        state === 'interrupted' && 'bg-muted-foreground/50',
        state === 'warning' && 'animate-pulse bg-warning',
        state === 'idle' && 'bg-muted-foreground/25',
      )}
    />
  );
});

function relativeSessionTime(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isFinite(then) === false) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export const SessionMenuButton = React.memo(function SessionMenuButton({
  session,
  childrenMap,
  sessionDerivedValues,
  isActive,
  currentSessionId,
  onResumeSession,
  onOpenAlongside,
  onCloseSession,
  onReopenSession,
  onDeleteSession,
  onRename,
  onRegenerateTitle,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  allWorkspaceTags,
  onAddTag,
  onRemoveTag,
}: SessionMenuButtonProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(session.title || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const derived = sessionDerivedValues.get(session.id) ?? {
    isStreaming: false,
    hasPendingPermission: false,
    isRunning: false,
  };

  const childSessions = childrenMap.get(session.id) ?? [];
  const hasChildren = childSessions.length > 0;
  const isClosed = session.status === 'closed';

  const hasActiveChild = childSessions.some((c) => c.id === currentSessionId);
  const hasPendingPermissionInSubtree = childSessions.some((child) => {
    const childDerived = sessionDerivedValues.get(child.id);
    return childDerived?.hasPendingPermission;
  });

  const completionRecord = useCompletionStore(selectCompletionRecord(session.id));
  const clearCompletion = useCompletionStore((s) => s.clearCompletion);
  const [isFlashing, setIsFlashing] = useState(false);

  useEffect(() => {
    if (!completionRecord) {
      setIsFlashing(false);
      return;
    }

    const remainingTime = COMPLETION_FLASH_DURATION_MS - (Date.now() - completionRecord.flashStartedAt);
    if (remainingTime <= 0) {
      setIsFlashing(false);
      if (completionRecord.type === 'flash-only') {
        clearCompletion(session.id);
      }
      return;
    }

    setIsFlashing(true);
    const timer = setTimeout(() => {
      setIsFlashing(false);
      if (completionRecord.type === 'flash-only') {
        clearCompletion(session.id);
      }
    }, remainingTime);

    return () => clearTimeout(timer);
  }, [completionRecord, session.id, clearCompletion]);

  const isSticky = completionRecord?.type === 'flash-then-sticky';

  const highlightClass = isFlashing
    ? 'animate-completion-flash rounded-md'
    : isSticky
      ? 'bg-[oklch(0.85_0.15_145_/_0.15)] rounded-md'
      : '';

  const hasFocusedRef = useRef(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      if (!hasFocusedRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
        hasFocusedRef.current = true;
      }
    } else {
      hasFocusedRef.current = false;
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) {
      setEditValue(session.title || '');
    }
  }, [isEditing, session.title]);

  const handleRenameStart = () => {
    setEditValue(session.title || '');
    setIsEditing(true);
  };

  const handleRenameCommit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleRenameCancel = () => {
    setIsEditing(false);
    setEditValue(session.title || '');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  const handleRowClick = (event?: React.MouseEvent) => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(session.id);
    } else if ((event?.metaKey || event?.ctrlKey) && onOpenAlongside) {
      onOpenAlongside(session.id);
    } else {
      onResumeSession(session.id);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect(session.id);
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick();
    }
  };

  // A pending permission request blocks the run and needs a decision, so it
  // outranks the generic running state and bubbles up from subagent children.
  const needsApproval = derived.hasPendingPermission || hasPendingPermissionInSubtree;

  const statusState: SessionDotState = needsApproval
    ? 'warning'
    : derived.isRunning
      ? 'running'
      : session.subagentStatus === 'error'
        ? 'error'
        : session.subagentStatus === 'interrupted'
          ? 'interrupted'
          : 'idle';

  const sdkClient = useSdkClient();
  const worktrees = useWorktreesQuery(sdkClient, session.workspaceId);
  const resolvedWorktree = resolveSessionWorktree(
    session.workspaceRootId,
    session.worktree,
    worktrees.data ?? [],
  );
  const metaParts: React.ReactNode[] = [];
  const worktreeLabel = getSessionWorktreeLabel(resolvedWorktree);
  if (needsApproval) metaParts.push(
    <span key="status" className="rounded-full bg-warning/15 px-1.5 py-0.5 font-medium text-warning">
      Needs approval
    </span>
  );
  else if (derived.isRunning) metaParts.push(<span key="status" className="text-primary">Running</span>);
  else if (session.subagentStatus === 'error') metaParts.push(<span key="status" className="text-destructive">Errored</span>);
  else if (session.subagentStatus === 'interrupted') metaParts.push(<span key="status">Interrupted</span>);
  if (session.workspaceRootId && worktreeLabel) metaParts.push(
    <span
      key="worktree"
      className={cn(
        'inline-block max-w-32 truncate align-bottom',
        resolvedWorktree?.state !== 'available' && 'text-destructive',
      )}
      title={worktreeLabel}
    >
      ⑂ {worktreeLabel}
    </span>,
  );
  for (const tag of session.tags?.slice(0, 2) ?? []) metaParts.push(<span key={`tag-${tag}`}>#{tag}</span>);
  if (childSessions.length > 0) metaParts.push(<span key="runs">{childSessions.length} {childSessions.length === 1 ? 'run' : 'runs'}</span>);
  const timeLabel = relativeSessionTime(session.updatedAt ?? session.createdAt);
  if (timeLabel) metaParts.push(<span key="time" className="tabular-nums opacity-70">{timeLabel}</span>);

  const rowClassName = cn(
    selected && selectionMode && 'bg-accent/50',
    selectionMode && 'cursor-pointer',
  );

  if (!hasChildren) {
    return (
      <TooltipProvider delayDuration={300}>
        <SidebarMenuItem>
          <div
            className={cn('relative flex w-full items-center rounded-md', rowClassName, highlightClass)}
            onClick={selectionMode ? handleRowClick : undefined}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleRenameCommit}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Rename session: ${session.title || 'Untitled'}`}
                className="flex-1 min-w-0 h-8 px-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                data-sidebar="menu-button"
                data-session-id={session.id}
                data-active={isActive}
                onClick={handleRowClick}
                onKeyDown={handleRowKeyDown}
                className={cn(
                  'peer/menu-button group/row flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none transition-colors',
                  'hover:bg-sidebar-accent/60 focus-visible:ring-1 focus-visible:ring-ring',
                  isActive && 'bg-primary/10 hover:bg-primary/15',
                )}
              >
                <div className="flex min-w-0 items-center gap-2 pr-7">
                  {selectionMode ? (
                    <button
                      type="button"
                      className="flex size-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent/70"
                      onClick={handleCheckboxClick}
                      aria-label={selected ? 'Deselect session' : 'Select session'}
                    >
                      {selected ? (
                        <CheckSquare className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <SessionStatusDot state={statusState} />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {session.title || 'Untitled'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {session.title || 'Untitled'}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[10px] leading-none text-muted-foreground/80">
                  {metaParts.map((part, index) => (
                    <React.Fragment key={index}>
                      {index > 0 && <span className="text-muted-foreground/40">·</span>}
                      {part}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            <SessionActionsDropdown
              isClosed={isClosed}
              isEditing={isEditing}
              selectionMode={selectionMode}
              onRename={handleRenameStart}
              onRegenerateTitle={onRegenerateTitle ? () => onRegenerateTitle(session.id) : undefined}
              onReopen={() => onReopenSession(session.id)}
              onClose={() => onCloseSession(session.id)}
              onDelete={() => onDeleteSession(session.id)}
              sessionTags={session.tags ?? []}
              allWorkspaceTags={allWorkspaceTags}
              onAddTag={onAddTag ? (tag) => onAddTag(session.id, tag) : undefined}
              onRemoveTag={onRemoveTag ? (tag) => onRemoveTag(session.id, tag) : undefined}
              sessionId={session.id}
              onOpenAlongside={onOpenAlongside ? () => onOpenAlongside(session.id) : undefined}
            />
          </div>
        </SidebarMenuItem>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Collapsible
        defaultOpen={isActive || hasActiveChild || derived.hasPendingPermission || hasPendingPermissionInSubtree}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <div
            className={cn('relative flex w-full items-center rounded-md', rowClassName, highlightClass)}
            onClick={selectionMode ? handleRowClick : undefined}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleRenameCommit}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Rename session: ${session.title || 'Untitled'}`}
                className="flex-1 min-w-0 h-8 px-2 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
              />
            ) : (
              <div
                role="button"
                tabIndex={0}
                data-sidebar="menu-button"
                data-session-id={session.id}
                data-active={isActive}
                onClick={handleRowClick}
                onKeyDown={handleRowKeyDown}
                className={cn(
                  'peer/menu-button group/row relative flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none transition-colors',
                  'hover:bg-sidebar-accent/60 focus-visible:ring-1 focus-visible:ring-ring',
                  isActive && 'bg-primary/10 hover:bg-primary/15',
                )}
              >
                <div className="flex min-w-0 items-center gap-2 pr-14">
                  {selectionMode ? (
                    <button
                      type="button"
                      className="flex size-4 shrink-0 items-center justify-center rounded transition-colors hover:bg-accent/70"
                      onClick={handleCheckboxClick}
                      aria-label={selected ? 'Deselect session' : 'Select session'}
                    >
                      {selected ? (
                        <CheckSquare className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  ) : (
                    <SessionStatusDot state={statusState} />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {session.title || 'Untitled'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      {session.title || 'Untitled'}
                    </TooltipContent>
                  </Tooltip>
                  {!selectionMode && (
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="absolute top-1/2 right-7 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        aria-label="Toggle subagent runs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ChevronRight className="size-3.5 transition-transform duration-200 [[data-state=open]>&]:rotate-90" />
                      </button>
                    </CollapsibleTrigger>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1.5 pl-3.5 text-[10px] leading-none text-muted-foreground/80">
                  {metaParts.map((part, index) => (
                    <React.Fragment key={index}>
                      {index > 0 && <span className="text-muted-foreground/40">·</span>}
                      {part}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            <SessionActionsDropdown
              isClosed={isClosed}
              isEditing={isEditing}
              selectionMode={selectionMode}
              onRename={handleRenameStart}
              onRegenerateTitle={onRegenerateTitle ? () => onRegenerateTitle(session.id) : undefined}
              onReopen={() => onReopenSession(session.id)}
              onClose={() => onCloseSession(session.id)}
              onDelete={() => onDeleteSession(session.id)}
              sessionTags={session.tags ?? []}
              allWorkspaceTags={allWorkspaceTags}
              onAddTag={onAddTag ? (tag) => onAddTag(session.id, tag) : undefined}
              onRemoveTag={onRemoveTag ? (tag) => onRemoveTag(session.id, tag) : undefined}
              sessionId={session.id}
              onOpenAlongside={onOpenAlongside ? () => onOpenAlongside(session.id) : undefined}
            />
          </div>

          <CollapsibleContent>
            <SidebarMenuSub>
              {childSessions.map((child) => (
                <SessionMenuButton
                  key={child.id}
                  session={child}
                  childrenMap={childrenMap}
                  sessionDerivedValues={sessionDerivedValues}
                  isActive={currentSessionId === child.id}
                  currentSessionId={currentSessionId}
                  onResumeSession={onResumeSession}
                  onOpenAlongside={onOpenAlongside}
                  onCloseSession={onCloseSession}
                  onReopenSession={onReopenSession}
                  onDeleteSession={onDeleteSession}
                  onRename={onRename}
                  onRegenerateTitle={onRegenerateTitle}
                  selectionMode={selectionMode}
                  selected={selected}
                  onToggleSelect={onToggleSelect}
                  allWorkspaceTags={allWorkspaceTags}
                  onAddTag={onAddTag}
                  onRemoveTag={onRemoveTag}
                />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    </TooltipProvider>
  );
});
