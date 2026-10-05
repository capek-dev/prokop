import { useLayoutEffect, useRef } from 'react';
import type { RefCallback } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuGroup, ContextMenuItem,
  ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu';
import {
  activeGroupView, findViewGroup, findViewRegion, resolveViewLayout, useWorkspaceViewStore, VIEW_REGIONS,
  type ViewRegion, type WorkspaceViewId,
} from '@/stores/workspaceViewStore';
import { WorkspaceTabStrip, workspaceTabLabel } from '@/components/app/WorkspaceTabStrip';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { treeGroups, type SplitDirection } from '@/stores/workspaceSplitLayout';
import { useWorkspaceFocusStore } from '@/stores/workspaceFocusStore';
import { cn } from '@/lib/utils';

const REGION_LABELS: Record<ViewRegion, string> = { left: 'Left dock', center: 'Center', right: 'Right dock', bottom: 'Bottom dock' };

interface WorkspaceViewGroupProps {
  region: ViewRegion;
  groupId?: string;
  available: readonly WorkspaceViewId[];
  slotRef: RefCallback<HTMLDivElement>;
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
}

export function WorkspaceViewGroup({ region, groupId = region, available, slotRef, tabs }: WorkspaceViewGroupProps) {
  const groupRef = useRef<HTMLElement>(null);
  const focused = useWorkspaceFocusStore((state) => state.groupId === groupId);
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const focus = () => useWorkspaceFocusStore.getState().focusGroup(groupId);
    const pointerDown = () => {
      focus();
      if (!group.contains(document.activeElement)) group.focus({ preventScroll: true });
    };
    // View content is portaled from a sibling React tree. Listen on the DOM
    // boundary so transcript/editor interactions also select their dock.
    group.addEventListener('pointerdown', pointerDown, true);
    group.addEventListener('focusin', focus);
    return () => {
      group.removeEventListener('pointerdown', pointerDown, true);
      group.removeEventListener('focusin', focus);
    };
  }, [groupId]);
  const focusDestination = useRef<string | null>(null);
  const restoreMenuFocus = (event: Event) => {
    const destination = focusDestination.current;
    focusDestination.current = null;
    if (!destination) return;
    event.preventDefault();
    requestAnimationFrame(() => {
      const group = document.querySelector<HTMLElement>(`[data-view-group="${destination}"]`);
      const target = group?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?? group?.querySelector<HTMLElement>('[data-workspace-panel-menu]');
      target?.focus({ preventScroll: true });
    });
  };
  const storedLayout = useWorkspaceViewStore((state) => state.layout);
  const layout = resolveViewLayout(storedLayout, available);
  const activateView = useWorkspaceViewStore((state) => state.activateView);
  const moveView = useWorkspaceViewStore((state) => state.moveView);
  const hideView = useWorkspaceViewStore((state) => state.hideView);
  const activeId = activeGroupView(layout, groupId, available);
  const ids = layout.groups[groupId].viewIds.filter((id) => available.includes(id) && !layout.hidden.includes(id));
  const hiddenIds = available.filter((id) => layout.hidden.includes(id));
  const elsewhereIds = available.filter((id) => !layout.hidden.includes(id) && findViewGroup(layout, id) !== groupId);
  const destinations = VIEW_REGIONS.flatMap((target) => treeGroups(layout.roots[target]).map((id, index, all) => ({ id, label: `${REGION_LABELS[target]}${all.length > 1 ? ` ${index + 1}` : ''}` })));
  const directions: SplitDirection[] = region === 'center' ? ['right', 'down'] : [region === 'bottom' ? 'right' : 'down'];

  const select = (id: WorkspaceViewId) => {
    useWorkspaceFocusStore.getState().focusGroup(groupId);
    if (!groupRef.current?.contains(document.activeElement)) groupRef.current?.focus({ preventScroll: true });
    activateView(id);
    tabs[id]?.onActivate?.();
  };
  const close = (id: WorkspaceViewId) => {
    if (tabs[id]?.closeDisabled) return;
    if (tabs[id]?.dirty) select(id);
    tabs[id]?.onClose?.();
  };

  const renderTabActions = (id: WorkspaceViewId) => {
    return (
      <ContextMenuGroup>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuGroup>
              {destinations.filter((target) => target.id !== groupId).map((target) => (
                <ContextMenuItem key={target.id} onSelect={() => { focusDestination.current = target.id; moveView(id, target.id); tabs[id]?.onActivate?.(); }}>{target.label}</ContextMenuItem>
              ))}
            </ContextMenuGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {directions.map((direction) => <ContextMenuItem key={direction} disabled={ids.length < 2} onSelect={() => {
          const destination = useWorkspaceViewStore.getState().splitView(id, direction, available);
          if (destination) {
            focusDestination.current = destination;
            tabs[id]?.onActivate?.();
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-view-group="${destination}"] [role="tab"]`)?.focus({ preventScroll: true }));
          }
        }}>Split {direction}</ContextMenuItem>)}
        <ContextMenuSeparator />
        {tabs[id]?.onClose && <ContextMenuItem disabled={tabs[id]?.closeDisabled} onSelect={() => close(id)}>Close tab</ContextMenuItem>}
        {tabs[id]?.onCloseOthers && <ContextMenuItem onSelect={tabs[id]?.onCloseOthers}>Close other sessions</ContextMenuItem>}
        {tabs[id]?.onCloseAll && <ContextMenuItem onSelect={tabs[id]?.onCloseAll}>Close all session tabs</ContextMenuItem>}
        <ContextMenuItem onSelect={() => { focusDestination.current = groupId; hideView(id); }}>Hide view</ContextMenuItem>
      </ContextMenuGroup>
    );
  };

  return (
    <section ref={groupRef} tabIndex={-1} data-view-group={groupId} data-dock-focused={focused} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sidebar outline-none">
      <div className={cn('flex h-10 shrink-0 items-center gap-1 border-b border-border/40 px-1', focused && 'bg-muted/30')}>
        <WorkspaceTabStrip ids={ids} activeId={activeId} tabs={tabs} label={`${REGION_LABELS[region]} views`} onSelect={select} onClose={close}
          renderTabMenu={(id, trigger) => (
            <ContextMenu key={id}>
              <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
              <ContextMenuContent onCloseAutoFocus={restoreMenuFocus}>
                {renderTabActions(id)}
              </ContextMenuContent>
            </ContextMenu>
          )}
          onMove={(id, beforeId) => {
            if (!available.includes(id)) return;
            moveView(id, groupId, beforeId);
            tabs[id]?.onActivate?.();
            requestAnimationFrame(() => {
              const group = document.querySelector<HTMLElement>(`[data-view-group="${groupId}"]`);
              group?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
            });
          }} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button data-workspace-panel-menu variant="ghost" size="icon-xs" aria-label={`${REGION_LABELS[region]} panel options`}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40" onCloseAutoFocus={restoreMenuFocus}>
            {hiddenIds.length > 0 && <DropdownMenuGroup>
              <DropdownMenuLabel>Open here</DropdownMenuLabel>
              {hiddenIds.map((id) => <DropdownMenuItem key={id} onSelect={() => { focusDestination.current = groupId; moveView(id, groupId); tabs[id]?.onActivate?.(); }}>{workspaceTabLabel(id, tabs)}</DropdownMenuItem>)}
            </DropdownMenuGroup>}
            {elsewhereIds.length > 0 && <DropdownMenuGroup>
              <DropdownMenuLabel>Move here</DropdownMenuLabel>
              {elsewhereIds.map((id) => <DropdownMenuItem key={id} onSelect={() => { focusDestination.current = groupId; moveView(id, groupId); tabs[id]?.onActivate?.(); }}>
                <span className="truncate">{workspaceTabLabel(id, tabs)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{REGION_LABELS[findViewRegion(layout, id)]}</span>
              </DropdownMenuItem>)}
            </DropdownMenuGroup>}
            {(hiddenIds.length > 0 || elsewhereIds.length > 0) && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => { focusDestination.current = 'center'; useWorkspaceViewStore.getState().resetLayout(); }}>Reset arrangement</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={slotRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {!activeId && region === 'center' && <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">Open a session or add a view.</div>}
      </div>
    </section>
  );
}
