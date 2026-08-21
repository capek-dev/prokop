import { useState } from 'react';
import { Check, ChevronsUpDown, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Preconfig } from '@prokopai/sdk';

interface PreconfigSelectorProps {
  preconfigs: Preconfig[];
  selectedPreconfigId: string | null | undefined;
  onChangePreconfig: (preconfigId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}

export function PreconfigSelector({
  preconfigs,
  selectedPreconfigId,
  onChangePreconfig,
  disabled,
  compact = false,
  iconOnly = false,
}: PreconfigSelectorProps) {
  const [open, setOpen] = useState(false);

  const selectedPreconfig = preconfigs.find(p => p.id === selectedPreconfigId);

  const handleSelect = (preconfigId: string) => {
    onChangePreconfig(preconfigId);
    setOpen(false);
  };

  if (iconOnly) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Select config"
            disabled={disabled}
          >
            <Settings className="size-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0">
          <Command>
            <CommandInput placeholder="Search config..." />
            <CommandList className="max-h-[50vh] overflow-y-auto">
              {preconfigs.map((preconfig) => (
                <CommandItem
                  key={preconfig.id}
                  onSelect={() => handleSelect(preconfig.id)}
                  className="justify-between"
                >
                  <span>
                    {preconfig.name}
                    {preconfig.isDefault && (
                      <span className="ml-1 text-muted-foreground text-xs">
                        (default)
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      'size-4',
                      selectedPreconfigId === preconfig.id
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  if (compact) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-muted-foreground hover:bg-accent"
            role="combobox"
            aria-expanded={open}
            aria-label="Select config"
            disabled={disabled}
          >
            <Settings className="size-4 flex-shrink-0 text-muted-foreground" />
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0">
          <Command>
            <CommandInput placeholder="Search config..." />
            <CommandList className="max-h-[50vh] overflow-y-auto">
              {preconfigs.map((preconfig) => (
                <CommandItem
                  key={preconfig.id}
                  onSelect={() => handleSelect(preconfig.id)}
                  className="justify-between"
                >
                  <span>
                    {preconfig.name}
                    {preconfig.isDefault && (
                      <span className="ml-1 text-muted-foreground text-xs">
                        (default)
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      'size-4',
                      selectedPreconfigId === preconfig.id
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:bg-accent"
          role="combobox"
          aria-expanded={open}
          aria-label="Select config"
          disabled={disabled}
        >
          <Settings className="size-4 flex-shrink-0 text-muted-foreground" />
          <span className="truncate">
            {selectedPreconfig?.name || 'Select config'}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search config..." />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            {preconfigs.map((preconfig) => (
              <CommandItem
                key={preconfig.id}
                onSelect={() => handleSelect(preconfig.id)}
                className="justify-between"
              >
                <span>
                  {preconfig.name}
                  {preconfig.isDefault && (
                    <span className="ml-1 text-muted-foreground text-xs">
                      (default)
                    </span>
                  )}
                </span>
                <Check
                  className={cn(
                    'size-4',
                    selectedPreconfigId === preconfig.id
                      ? 'opacity-100'
                      : 'opacity-0'
                  )}
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
