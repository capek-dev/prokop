import React, { useCallback } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, ArrowUp, ArrowDown, X } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import type { StoreActions } from '@/hooks/useOverviewGroups';

interface SortableOverviewContainerProps {
  workspaceIds: string[];
  activeGroupId: string | null;
  groupActions: StoreActions;
  children: (props: {
    workspace: Workspace;
    index: number;
    totalCount: number;
    controls: React.ReactNode;
  }) => React.ReactNode;
  workspaces: Workspace[];
}

/**
 * Provides the DnD context for the sortable workspace list.
 * Each child workspace is rendered via the render callback with
 * its index and total count so it can wire Move up/down buttons.
 */
export function SortableOverviewContainer({
  workspaceIds,
  activeGroupId,
  groupActions,
  children,
  workspaces,
}: SortableOverviewContainerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id || !activeGroupId) return;
      const targetIndex = workspaceIds.indexOf(String(over.id));
      if (targetIndex === -1) return;
      groupActions.reorderWorkspace(activeGroupId, String(active.id), targetIndex);
    },
    [workspaceIds, activeGroupId, groupActions],
  );

  const workspaceMap = React.useMemo(
    () => new Map(workspaces.map((w) => [w.id, w])),
    [workspaces],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
        {workspaceIds.map((wsId, index) => {
          const workspace = workspaceMap.get(wsId);
          if (!workspace) return null;
          return (
            <SortableWorkspaceItem
              key={wsId}
              workspace={workspace}
              index={index}
              totalCount={workspaceIds.length}
              activeGroupId={activeGroupId}
              groupActions={groupActions}
            >
              {children}
            </SortableWorkspaceItem>
          );
        })}
      </SortableContext>
    </DndContext>
  );
}

interface SortableWorkspaceItemProps {
  workspace: Workspace;
  index: number;
  totalCount: number;
  activeGroupId: string | null;
  groupActions: StoreActions;
  children: (props: {
    workspace: Workspace;
    index: number;
    totalCount: number;
    controls: React.ReactNode;
  }) => React.ReactNode;
}

function SortableWorkspaceItem({
  workspace,
  index,
  totalCount,
  activeGroupId,
  groupActions,
  children,
}: SortableWorkspaceItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id });

  const canMoveUp = index > 0;
  const canMoveDown = index < totalCount - 1;

  const handleMoveUp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activeGroupId || !canMoveUp) return;
      groupActions.reorderWorkspace(activeGroupId, workspace.id, index - 1);
    },
    [activeGroupId, groupActions, workspace.id, index, canMoveUp],
  );

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activeGroupId || !canMoveDown) return;
      groupActions.reorderWorkspace(activeGroupId, workspace.id, index + 1);
    },
    [activeGroupId, groupActions, workspace.id, index, canMoveDown],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!activeGroupId) return;
      groupActions.toggleWorkspace(activeGroupId, workspace.id);
    },
    [activeGroupId, groupActions, workspace.id],
  );

  const controls = (
    <div
      className="flex shrink-0 items-center gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Reorder ${workspace.name}`}
        className="touch-none cursor-grab rounded p-0.5 hover:bg-sidebar-accent active:cursor-grabbing"
        title="Drag to reorder"
        data-overview-drag-handle
      >
        <GripVertical className="size-3 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleMoveUp}
        disabled={!canMoveUp}
        className="rounded p-0.5 hover:bg-sidebar-accent disabled:opacity-30"
        aria-label={`Move ${workspace.name} up`}
        title="Move up"
      >
        <ArrowUp className="size-3 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleMoveDown}
        disabled={!canMoveDown}
        className="rounded p-0.5 hover:bg-sidebar-accent disabled:opacity-30"
        aria-label={`Move ${workspace.name} down`}
        title="Move down"
      >
        <ArrowDown className="size-3 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleRemove}
        className="rounded p-0.5 hover:bg-sidebar-accent"
        aria-label={`Remove ${workspace.name} from group`}
        title="Remove from group"
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {children({ workspace, index, totalCount, controls })}
    </div>
  );
}
