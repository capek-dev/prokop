import { useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import type { WorkspaceViewId } from '@/stores/workspaceViewStore';
import type { WorkspaceTab } from '@/components/app/workspaceTab';
import { workspaceTabLabel } from '@/components/app/WorkspaceTabStrip';
import { WorkspaceTabStatus } from '@/components/app/WorkspaceTabStatus';
import { WorkspaceTabIcon } from '@/components/app/WorkspaceTabIcon';

interface WorkspaceTabSearchProps {
  ids: readonly WorkspaceViewId[];
  tabs: Partial<Record<WorkspaceViewId, WorkspaceTab>>;
  onSelect: (id: WorkspaceViewId) => void;
}

export function WorkspaceTabSearch({ ids, tabs, onSelect }: WorkspaceTabSearchProps) {
  const [open, setOpen] = useState(false);
  const selectedId = useRef<WorkspaceViewId | null>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Find open tab"><Search className="size-3.5" /></Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[90vw] p-0" onCloseAutoFocus={(event) => {
        const id = selectedId.current;
        selectedId.current = null;
        if (!id) return;
        event.preventDefault();
        requestAnimationFrame(() => {
          Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            .find((tab) => tab.getAttribute('aria-controls') === `workspace-view-${id}`)?.focus({ preventScroll: true });
        });
      }}>
        <Command label="Find tab by name or path">
          <CommandInput placeholder="Find tab by name or path..." aria-label="Find tab by name or path" />
          <CommandList>
            <CommandEmpty>No matching tabs.</CommandEmpty>
            {ids.map((id) => (
              <CommandItem key={id} value={id} keywords={[workspaceTabLabel(id, tabs), tabs[id]?.description ?? '']} onSelect={() => { selectedId.current = id; setOpen(false); onSelect(id); }}>
                <WorkspaceTabIcon id={id} />
                <WorkspaceTabStatus status={tabs[id]?.status} />
                <span className="min-w-0">
                  <span className="block truncate">{workspaceTabLabel(id, tabs)}</span>
                  {tabs[id]?.description && <span className="block truncate text-xs text-muted-foreground">{tabs[id]?.description}</span>}
                </span>
                {tabs[id]?.dirty && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unsaved changes" />}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
