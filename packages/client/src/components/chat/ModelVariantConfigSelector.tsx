import { useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, Cpu, Brain, Bot, Cog } from 'lucide-react';
import type { Preconfig } from '@prokopai/sdk';
import { useServerDataStore } from '@/stores/serverDataStore';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface Model {
  id: string;
  name: string;
  contextWindow: number;
  tier: 'budget' | 'standard' | 'premium';
  providerId: string;
  providerName: string;
}

interface VariantOption {
  providerOptions: Record<string, unknown>;
}

interface ModelVariantConfigSelectorProps {
  models: Model[];
  selectedModelId: string | null | undefined;
  selectedProviderId?: string | null;
  fallbackModelName?: string;
  onChangeModel: (modelId: string, providerId: string) => void;
  variants?: Record<string, VariantOption> | undefined;
  selectedVariant: string | null;
  onChangeVariant: (variant: string | null) => void;
  preconfigs: Preconfig[];
  selectedPreconfigId: string | null | undefined;
  onChangePreconfig: (preconfigId: string) => void;
  disabled?: boolean;
  lockPreconfig?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
}

const VARIANT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  minimal: 'Minimal',
  max: 'Max',
};

const NONE_VALUE = '__none__';

function capitalizeVariant(key: string): string {
  return VARIANT_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function getTierBadge(tier: string): string {
  switch (tier) {
    case 'budget': return '$';
    case 'standard': return '$$';
    case 'premium': return '$$$';
    default: return '';
  }
}

type Section = 'model' | 'variant' | 'config';

export function ModelVariantConfigSelector({
  models,
  selectedModelId,
  selectedProviderId,
  fallbackModelName,
  onChangeModel,
  variants,
  selectedVariant,
  onChangeVariant,
  preconfigs,
  selectedPreconfigId,
  onChangePreconfig,
  disabled,
  compact = false,
  iconOnly = false,
  lockPreconfig = false,
}: ModelVariantConfigSelectorProps) {
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const isMobile = useIsMobile();
  const agents = useServerDataStore((s) => s.agents);
  const isAgentPreconfig = (id: string) => agents.some(a => a.id === id);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setOpenSection(null);
  };

  const groupedModels = models.reduce((acc, model) => {
    if (!acc[model.providerName]) {
      acc[model.providerName] = [];
    }
    acc[model.providerName].push(model);
    return acc;
  }, {} as Record<string, Model[]>);

  const compositeKey = (model: Model) => model.providerId + ':' + model.id;

  const selectedComposite = selectedModelId && selectedProviderId
    ? selectedProviderId + ':' + selectedModelId
    : null;

  const selectedModel = selectedModelId && selectedProviderId
    ? models.find((m) => m.providerId === selectedProviderId && m.id === selectedModelId)
    : models.find((m) => m.id === selectedModelId);

  const selectedPreconfig = preconfigs.find((p) => p.id === selectedPreconfigId);
  const modelDisplayName = selectedModel?.name || fallbackModelName || 'Select model';
  const variantDisplayName = selectedVariant ? capitalizeVariant(selectedVariant) : null;
  const fullSelectionLabel = [
    modelDisplayName,
    variantDisplayName,
    selectedPreconfig && !lockPreconfig ? selectedPreconfig.name : null,
  ].filter(Boolean).join(', ');

  const hasVariants = !!variants && Object.keys(variants).length > 0;
  const variantKeys = hasVariants ? Object.keys(variants!) : [];

  const handleSelectModel = (composite: string) => {
    const colonIdx = composite.indexOf(':');
    const providerId = composite.slice(0, colonIdx);
    const modelId = composite.slice(colonIdx + 1);
    onChangeModel(modelId, providerId);
    setOpenSection(null);
  };

  const handleSelectVariant = (value: string) => {
    onChangeVariant(value === NONE_VALUE ? null : value);
    setOpenSection(null);
  };

  const handleSelectPreconfig = (preconfigId: string) => {
    onChangePreconfig(preconfigId);
    setOpenSection(null);
  };

  const toggleSection = (section: Section) => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  const renderTriggerLabel = () => {
    if (compact) {
      return <span className="truncate font-medium">{modelDisplayName}</span>;
    }

    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{modelDisplayName}</span>
        {variantDisplayName && (
          <span className="shrink-0 text-muted-foreground">
            {'(' + variantDisplayName + ')'}
          </span>
        )}
        {selectedPreconfig && !lockPreconfig && (
          <span className={cn(
            'max-w-[40%] min-w-0 truncate text-muted-foreground',
            isAgentPreconfig(selectedPreconfig.id) && 'text-primary font-medium',
          )}>
            · {selectedPreconfig.name}
          </span>
        )}
      </span>
    );
  };

  // --- Shared list items ---

  const modelItems = (
    <>
      {Object.entries(groupedModels).map(([providerName, providerModels]) => (
        <CommandGroup key={providerName} heading={providerName}>
          {providerModels.map((model) => {
            const key = compositeKey(model);
            return (
              <CommandItem
                key={key}
                value={key}
                showCheck={false}
                onSelect={() => handleSelectModel(key)}
              >
                <span>{model.name}</span>
                <span className="text-muted-foreground text-xs">
                  {getTierBadge(model.tier)}
                </span>
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
      ))}
    </>
  );

  const variantItems = (
    <>
      <CommandItem
        value="default none"
        showCheck={false}
        onSelect={() => handleSelectVariant(NONE_VALUE)}
      >
        <span>Default</span>
        <Check
          className={cn(
            'ml-auto size-4',
            selectedVariant === null ? 'opacity-100' : 'opacity-0',
          )}
        />
      </CommandItem>
      {variantKeys.map((key) => (
        <CommandItem
          key={key}
          value={key}
          showCheck={false}
          onSelect={() => handleSelectVariant(key)}
        >
          <span>{capitalizeVariant(key)}</span>
          <Check
            className={cn(
              'ml-auto size-4',
              selectedVariant === key ? 'opacity-100' : 'opacity-0',
            )}
          />
        </CommandItem>
      ))}
    </>
  );

  const configItems = (
    <>
      {preconfigs.map((preconfig) => {
        const isAgent = isAgentPreconfig(preconfig.id);
        const Icon = isAgent ? Bot : Cog;
        return (
        <CommandItem
          key={preconfig.id}
          value={preconfig.id + ' ' + preconfig.name}
          showCheck={false}
          onSelect={() => handleSelectPreconfig(preconfig.id)}
        >
          <Icon className={cn('mr-2 size-4 shrink-0', isAgent ? 'text-primary' : 'text-muted-foreground')} />
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
              'ml-auto size-4',
              selectedPreconfigId === preconfig.id ? 'opacity-100' : 'opacity-0',
            )}
          />
        </CommandItem>
        );
      })}
    </>
  );

  // --- Collapsed header row ---

  const headerBtn = (
    icon: ReactNode,
    label: string,
    value: string,
    section: Section,
  ) => (
    <button
      type="button"
      onClick={() => toggleSection(section)}
      className={cn(
        'flex min-w-0 items-center gap-1.5 px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
        isMobile ? 'w-full border-b border-border' : 'flex-1 flex-col items-start gap-0.5 border-r border-border last:border-r-0',
        openSection === section && 'bg-accent',
      )}
    >
      <span className={cn('flex items-center gap-1.5 text-xs font-medium text-muted-foreground', !isMobile && 'w-full')}>
        {icon}
        {label}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className={cn(
          'min-w-0 font-medium',
          isMobile ? 'flex-1 whitespace-normal break-words' : 'truncate',
        )}>
          {value}
        </span>
        <ChevronsUpDown className="ml-auto size-3 shrink-0 opacity-40" />
      </span>
    </button>
  );

  const expandedList = (section: Section) => {
    if (openSection !== section) return null;
    if (section === 'model') {
      return (
        <Command>
          <CommandInput placeholder="Search model..." autoFocus />
          <CommandList className="max-h-[40vh]">
            <CommandEmpty>No model found.</CommandEmpty>
            {modelItems}
          </CommandList>
        </Command>
      );
    }
    if (section === 'variant') {
      return (
        <Command>
          <CommandInput placeholder="Search variant..." autoFocus />
          <CommandList className="max-h-[30vh]">
            {variantItems}
          </CommandList>
        </Command>
      );
    }
    return (
      <Command>
        <CommandInput placeholder="Search config..." autoFocus />
        <CommandList className="max-h-[30vh]">
          {configItems}
        </CommandList>
      </Command>
    );
  };

  const sections: { icon: ReactNode; label: string; value: string; section: Section }[] = [
    { icon: <Cpu className="size-3.5" />, label: 'Model', value: modelDisplayName, section: 'model' },
    ...(hasVariants
      ? [{ icon: <Brain className="size-3.5" />, label: 'Variant', value: selectedVariant ? capitalizeVariant(selectedVariant) : 'Default', section: 'variant' as const }]
      : []),
    ...(preconfigs.length > 0 && !lockPreconfig
      ? [{ icon: (() => {
            const isSelectedAgent = selectedPreconfig ? isAgentPreconfig(selectedPreconfig.id) : false;
            const Icon = isSelectedAgent ? Bot : Cog;
            return <Icon className={cn('size-3.5', isSelectedAgent && 'text-primary')} />;
          })(), label: 'Config', value: selectedPreconfig?.name || 'None', section: 'config' as const }]
      : []),
  ];

  const pickerSections = (
    <div className={isMobile ? 'flex flex-col' : 'flex flex-row'}>
      {sections.map((s) => (
        <div key={s.section} className="contents">
          {headerBtn(s.icon, s.label, s.value, s.section)}
          {isMobile && expandedList(s.section)}
        </div>
      ))}
    </div>
  );

  const popoverContent = (
    <PopoverContent className="w-[480px] p-0">
      <div className="flex flex-col">
        {pickerSections}
        {openSection && (
          <div className="border-t border-border">
            {expandedList(openSection)}
          </div>
        )}
      </div>
    </PopoverContent>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            role="combobox"
            aria-expanded={open}
            aria-label={'Model and configuration: ' + fullSelectionLabel}
            disabled={disabled}
          >
            <Cpu />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl"
        >
          <SheetHeader className="shrink-0 border-b border-border pr-12">
            <SheetTitle>Model and configuration</SheetTitle>
            <SheetDescription className="break-words">
              {fullSelectionLabel}
            </SheetDescription>
          </SheetHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {pickerSections}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (iconOnly) {
    return (
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            role="combobox"
            aria-expanded={open}
            aria-label={'Model and configuration: ' + fullSelectionLabel}
            title={fullSelectionLabel}
            disabled={disabled}
          >
            <Cpu />
          </Button>
        </PopoverTrigger>
        {popoverContent}
      </Popover>
    );
  }

  const maxWidth = compact ? 'max-w-[180px]' : 'max-w-[280px]';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="default"
          role="combobox"
          aria-expanded={open}
          aria-label={'Model and configuration: ' + fullSelectionLabel}
          title={fullSelectionLabel}
          className="min-w-0 px-2 text-muted-foreground"
          disabled={disabled}
        >
          <span className={cn('min-w-0 flex-1', maxWidth)}>
            {renderTriggerLabel()}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {popoverContent}
    </Popover>
  );
}
