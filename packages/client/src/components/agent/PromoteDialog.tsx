import { useState } from 'react';
import type { Preconfig } from '@prokopai/sdk';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { usePromoteAgent } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface PromoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PromoteDialog({ open, onOpenChange }: PromoteDialogProps) {
  const sdkClient = useSdkClient();
  const preconfigs = useServerDataStore(s => s.preconfigs);
  const agents = useServerDataStore(s => s.agents);
  const promoteAgent = usePromoteAgent(sdkClient);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const promotedIds = new Set(agents.map(a => a.id));
  const available = preconfigs.filter(p => !promotedIds.has(p.id));
  const selected = available.find(p => p.id === selectedId) ?? null;

  const reset = () => {
    setSelectedId(null);
    setSelectorOpen(false);
  };

  const handleSubmit = () => {
    if (!selectedId) return;
    promoteAgent.mutate(selectedId, {
      onSuccess: () => {
        reset();
        onOpenChange(false);
      },
    });
  };

  const handleSelect = (preconfig: Preconfig) => {
    setSelectedId(preconfig.id);
    setSelectorOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote Preconfig to Agent</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <span className="text-sm font-medium">Preconfig</span>
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={selectorOpen}
                  className="w-full justify-between font-mono text-sm h-9"
                >
                  <span className="truncate">
                    {selected ? selected.name : 'Select a preconfig...'}
                  </span>
                  <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[280px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search preconfigs..." />
                  <CommandList className="max-h-[50vh] overflow-y-auto">
                    <CommandEmpty>No preconfigs available.</CommandEmpty>
                    <CommandGroup>
                      {available.map(preconfig => (
                        <CommandItem
                          key={preconfig.id}
                          value={`${preconfig.name} ${preconfig.id}`}
                          onSelect={() => handleSelect(preconfig)}
                          className="justify-between"
                        >
                          <span className="truncate">{preconfig.name}</span>
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              selectedId === preconfig.id ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedId || promoteAgent.isPending}
          >
            {promoteAgent.isPending ? 'Promoting...' : 'Promote'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
