import { useState } from 'react';
import { Check, ChevronsUpDown, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
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

interface Model {
  id: string;
  name: string;
  contextWindow: number;
  providerId: string;
  providerName: string;
}

interface ModelSelectorProps {
  models: Model[];
  selectedModelId: string | null | undefined;
  selectedProviderId?: string | null;
  onChangeModel: (modelId: string, providerId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}

function renderCommandItems(
  groupedModels: Record<string, Model[]>,
  selectedComposite: string | null,
  handleSelect: (composite: string) => void,
  compositeKey: (model: Model) => string,
) {
  return Object.entries(groupedModels).map(([providerName, providerModels]) => (
    <CommandGroup key={providerName} heading={providerName}>
      {providerModels.map((model) => {
        const key = compositeKey(model);
        return (
          <CommandItem
            key={key}
            value={key}
            showCheck={false}
            onSelect={() => handleSelect(key)}
          >
            <span>{model.name}</span>
            <Check
              className={cn(
                'ml-auto size-4',
                selectedComposite === key ? 'opacity-100' : 'opacity-0',
              )}
            />
          </CommandItem>
        );
      })}
    </CommandGroup>
  ));
}

export function ModelSelector({
  models,
  selectedModelId,
  selectedProviderId,
  onChangeModel,
  disabled,
  compact = false,
  iconOnly = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const groupedModels = models.reduce((acc, model) => {
    if (!acc[model.providerName]) {
      acc[model.providerName] = [];
    }
    acc[model.providerName].push(model);
    return acc;
  }, {} as Record<string, Model[]>);

  const compositeKey = (model: Model) => model.providerId + ':' + model.id;

  const handleSelect = (composite: string) => {
    const colonIdx = composite.indexOf(':');
    const providerId = composite.slice(0, colonIdx);
    const modelId = composite.slice(colonIdx + 1);
    const model = models.find((m) => m.providerId === providerId && m.id === modelId);
    if (model) {
      onChangeModel(modelId, providerId);
      setOpen(false);
    }
  };

  const selectedComposite = selectedModelId && selectedProviderId
    ? selectedProviderId + ':' + selectedModelId
    : null;

  const selectedModel = selectedModelId && selectedProviderId
    ? models.find((m) => m.providerId === selectedProviderId && m.id === selectedModelId)
    : models.find((m) => m.id === selectedModelId);

  const commandItems = renderCommandItems(groupedModels, selectedComposite, handleSelect, compositeKey);

  if (iconOnly) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Select model"
            disabled={disabled}
          >
            <Cpu className="size-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0">
          <Command>
            <CommandInput placeholder="Search model..." />
            <CommandList className="max-h-[50vh] overflow-y-auto">
              <CommandEmpty>No model found.</CommandEmpty>
              {commandItems}
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
            role="combobox"
            aria-expanded={open}
            aria-label="Select model"
            className="h-8 gap-1.5 px-2 text-muted-foreground hover:bg-accent"
            disabled={disabled}
          >
            <Cpu className="size-4 flex-shrink-0 text-muted-foreground" />
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0">
          <Command>
            <CommandInput placeholder="Search model..." />
            <CommandList className="max-h-[50vh] overflow-y-auto">
              <CommandEmpty>No model found.</CommandEmpty>
              {commandItems}
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
          role="combobox"
          aria-expanded={open}
          aria-label="Select model"
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:bg-accent"
          disabled={disabled}
        >
          <Cpu className="size-4 flex-shrink-0 text-muted-foreground" />
          <span className="truncate">
            {selectedModel?.name || 'Select model'}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0">
        <Command>
          <CommandInput placeholder="Search model..." />
          <CommandList className="max-h-[50vh] overflow-y-auto">
            <CommandEmpty>No model found.</CommandEmpty>
            {commandItems}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
