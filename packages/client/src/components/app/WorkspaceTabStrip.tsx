import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceViewId, WorkspaceToolViewId } from '@/stores/workspaceViewStore';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { WorkspaceTabStatus } from '@/components/app/WorkspaceTabStatus';
import { WorkspaceTabIcon } from '@/components/app/WorkspaceTabIcon';
import { useWorkspaceTabDrag } from '@/components/app/useWorkspaceTabDrag';
import { cn } from '@/lib/utils';

export const VIEW_LABELS: Record<WorkspaceToolViewId, string> = {
  usage: 'Usage',
  sessions: 'Sessions', conversations: 'Conversations', explorer: 'Explorer', changes: 'Changes', branches: 'Branches', worktrees: 'Worktrees', editor: 'Editor', terminals: 'Terminals',
};

export function workspaceTabLabel(id: WorkspaceViewId, tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>): string {
  return tabs[id]?.label ?? VIEW_LABELS[id as WorkspaceToolViewId] ?? 'File';
}

interface WorkspaceTabStripProps {
  ids: readonly WorkspaceViewId[];
  activeId: WorkspaceViewId | null;
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  label: string;
  onSelect: (id: WorkspaceViewId) => void;
  onClose: (id: WorkspaceViewId) => void;
  renderTabMenu?: (id: WorkspaceViewId, trigger: ReactElement) => ReactNode;
  onMove?: (id: WorkspaceViewId, beforeId: WorkspaceViewId | null) => void;
}

export function WorkspaceTabStrip({ ids, activeId, tabs, label, onSelect, onClose, onMove, renderTabMenu }: WorkspaceTabStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const drag = useWorkspaceTabDrag(scrollerRef, onMove);
  // Measure in the next frame, not in the commit: a layout-effect read forces
  // a synchronous layout of the whole freshly committed page (session switches).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      const selected = scroller?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
      if (!scroller || !selected) return;
      const bounds = scroller.getBoundingClientRect();
      const tabBounds = selected.getBoundingClientRect();
      if (tabBounds.left < bounds.left) scroller.scrollLeft += tabBounds.left - bounds.left;
      else if (tabBounds.right > bounds.right) scroller.scrollLeft += tabBounds.right - bounds.right;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, ids]);

  return (
    <div ref={scrollerRef} role="tablist" aria-label={label} {...drag.stripEvents} className={cn(
      'board-tab-strip-scrollbar relative flex h-full min-w-0 flex-1 items-center overflow-x-auto overflow-y-hidden',
      drag.insertion && 'bg-primary/5 ring-1 ring-inset ring-primary/30',
    )}>
      {ids.map((id, index) => {
        const tab = tabs[id];
        const name = workspaceTabLabel(id, tabs);
        const trigger = (
          <div key={id} data-workspace-tab-id={id} className={cn(
            'relative flex shrink-0 items-center rounded-md has-[[role=tab]:focus-visible]:ring-1 has-[[role=tab]:focus-visible]:ring-inset has-[[role=tab]:focus-visible]:ring-ring/60',
            id === activeId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            index < ids.length - 1 && id !== activeId && ids[index + 1] !== activeId
              && 'after:pointer-events-none after:absolute after:right-0 after:top-2 after:h-4 after:w-px after:bg-border hover:after:opacity-0',
          )}>
            <button
              type="button" role="tab" aria-label={name}
              draggable={!!onMove} onDragStart={(event) => drag.start(id, event)}
              aria-selected={id === activeId} aria-controls={`workspace-view-${id}`}
              tabIndex={id === activeId ? 0 : -1} title={`${tab?.description ?? name}${tab?.status ? ` (${tab.status})` : ''}`}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => {
                if (event.key === 'Delete' && tab?.onClose) {
                  event.preventDefault();
                  onClose(id);
                  return;
                }
                const index = ids.indexOf(id);
                const next = event.key === 'ArrowRight' ? ids[(index + 1) % ids.length]
                  : event.key === 'ArrowLeft' ? ids[(index + ids.length - 1) % ids.length]
                    : event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : null;
                if (!next) return;
                event.preventDefault();
                onSelect(next);
                scrollerRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[ids.indexOf(next)]?.focus();
              }}
              className="flex h-8 max-w-64 items-center gap-1.5 rounded-md px-3 text-xs outline-none"
            >
              <WorkspaceTabIcon id={id} />
              <WorkspaceTabStatus status={tab?.status} />
              <span className="truncate">{name}</span>
              {tab?.dirty && <span role="img" aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-primary" />}
            </button>
            {tab?.onClose && (
              <button type="button" className="mr-1 rounded p-0.5 outline-none hover:bg-background focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/60 disabled:opacity-40" aria-label={`Close ${name}`} tabIndex={id === activeId ? 0 : -1} disabled={tab.closeDisabled} onClick={() => onClose(id)}>
                <X className="size-3" />
              </button>
            )}
          </div>
        );
        return renderTabMenu ? renderTabMenu(id, trigger) : trigger;
      })}
      {drag.insertion && <span data-tab-insertion-marker aria-hidden="true" className="pointer-events-none absolute top-1/2 h-8 w-0.5 -translate-y-1/2 rounded-full bg-primary" style={{ left: Math.max(0, drag.insertion.left - 1) }} />}
    </div>
  );
}
