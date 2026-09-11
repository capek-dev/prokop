import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Workspace } from '@prokopai/sdk';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LearningSourcePickerProps {
  workspaces: Workspace[];
  selectedIds: string[];
  onChange(ids: string[]): void;
}

/** Matches the searchable, bounded tool list in the preconfig editor. */
export function LearningSourcePicker({ workspaces, selectedIds, onChange }: LearningSourcePickerProps) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const visible = workspaces.filter(workspace => !workspace.settings.isAgentHome
    && `${workspace.name} ${workspace.path}`.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <div className="flex min-w-0 flex-col gap-2">
    {selectedIds.length === 0
      ? <p className="text-xs text-muted-foreground">No sources selected yet. Learning stays idle until you select at least one workspace.</p>
      : <p className="text-xs text-muted-foreground">{selectedIds.length} selected. Only selected eligible workspaces contribute.</p>}
    <Input aria-label="Search learning sources" placeholder="Search workspaces..." value={search} onChange={event => setSearch(event.target.value)} />
    <div className="dialog-scrollbar max-h-[200px] overflow-y-auto rounded-md border" role="group" aria-label="Workspace sources">
      {visible.map(workspace => {
        const selected = selectedIds.includes(workspace.id);
        const denied = workspace.settings.allowPersonalLearning !== undefined && workspace.settings.allowPersonalLearning !== true;
        return <button key={workspace.id} type="button" aria-pressed={selected} disabled={denied && !selected}
          onClick={() => onChange(selected ? selectedIds.filter(id => id !== workspace.id) : [...selectedIds, workspace.id])}
          className={cn('flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-accent disabled:opacity-50', selected && 'bg-primary/10')}>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs">{workspace.name}</span>
            <span className="truncate text-xs text-muted-foreground">{denied ? 'Personal learning disabled' : workspace.path}</span>
          </span>
          <Check aria-hidden="true" className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
        </button>;
      })}
      {!visible.length && <p className="p-3 text-xs text-muted-foreground">No matching workspaces.</p>}
    </div>
  </div>;
}
