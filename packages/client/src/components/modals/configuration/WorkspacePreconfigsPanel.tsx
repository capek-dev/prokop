import { Check, Star, Bot, Cog } from 'lucide-react';
import type { Preconfig, WorkspacePreconfigSettings } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';

interface PreconfigsPanelProps {
  preconfigs: Preconfig[];
  settings: WorkspacePreconfigSettings;
  onChange: (settings: WorkspacePreconfigSettings) => void;
}

export function WorkspacePreconfigsPanel({ preconfigs, settings, onChange }: PreconfigsPanelProps) {
  const agents = useServerDataStore(s => s.agents);
  const agentIds = new Set(agents.map(a => a.id));
  const primaryPreconfigs = preconfigs.filter(p => p.mode !== 'subagent');
  const selectedIds = settings.selectedIds;
  const isAllMode = selectedIds === null;
  const selectedSet = new Set(isAllMode ? primaryPreconfigs.map(p => p.id) : selectedIds);

  const togglePreconfig = (id: string) => {
    const current = isAllMode ? primaryPreconfigs.map(p => p.id) : [...(selectedIds ?? [])];
    const newIds = current.includes(id)
      ? current.filter(sid => sid !== id)
      : [...current, id];

    let newDefault = settings.defaultId;
    if (newDefault && !newIds.includes(newDefault)) {
      newDefault = newIds[0] ?? null;
    }

    onChange({ selectedIds: newIds, defaultId: newDefault });
  };

  const setDefault = (id: string) => {
    if (!selectedSet.has(id)) return;
    onChange({ selectedIds: isAllMode ? [id] : selectedIds, defaultId: id });
  };

  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="space-y-0.5">
        <Label>Preconfigs</Label>
        <p className="text-xs text-muted-foreground">
          Select which preconfigs are available in this workspace and choose the default for new chats.
          When none are selected, all primary preconfigs are shown.
        </p>
      </div>

      <div className="grid gap-2">
        {primaryPreconfigs.map(preconfig => {
          const isSelected = selectedSet.has(preconfig.id);
          const isDefault = settings.defaultId === preconfig.id;
          return (
            <div
              key={preconfig.id}
              className={cn(
                'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                isDefault
                  ? 'border-primary bg-primary/5'
                  : 'border-border',
              )}
            >
              <button
                type="button"
                onClick={() => togglePreconfig(preconfig.id)}
                className={cn(
                  'flex items-center gap-2 flex-1 min-w-0 text-left',
                  !isSelected && 'text-muted-foreground',
                )}
              >
                <div
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40',
                  )}
                >
                  {isSelected && <Check className="size-3" />}
                </div>
                {agentIds.has(preconfig.id)
                  ? <Bot className="size-4 shrink-0 text-primary" />
                  : <Cog className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate font-medium">{preconfig.name}</span>
              </button>
              <button
                type="button"
                onClick={() => setDefault(preconfig.id)}
                disabled={!isSelected}
                title={isDefault ? 'Default preconfig' : 'Set as default'}
                className="p-1 rounded hover:bg-secondary transition-colors disabled:opacity-30"
              >
                <Star
                  className={cn(
                    'size-4',
                    isDefault ? 'fill-primary text-primary' : 'text-muted-foreground',
                  )}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
