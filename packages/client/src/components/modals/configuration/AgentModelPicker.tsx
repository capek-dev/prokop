import { useState } from 'react';
import type { CodexModel, ModelWithStatus } from '@prokopai/sdk';
import { Check, Cpu, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AnthropicMark, OpenAIMark, ProkopMark } from '@/components/branding/BrandMarks';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

/** A model pin: `modelHarness` empty means "use the server default" (no pin). */
export interface AgentModelSelection {
  model: string;
  provider: string;
  variant: string;
  modelHarness: '' | 'prokop' | 'codex-cli' | 'claude-cli';
}

interface AgentModelPickerProps {
  /** Prokop catalog models (models.json providers). */
  models: ModelWithStatus[];
  /** Host Codex CLI catalog; empty hides the Codex tab. */
  codexModels: CodexModel[];
  /** Host Claude CLI catalog; empty hides the Claude tab. */
  claudeModels: CodexModel[];
  value: AgentModelSelection;
  onChange: (next: AgentModelSelection) => void;
  /** Copy for the inherit row/trigger when no model is pinned (agent editor:
   * "Use server default", learning: "Use agent default"). */
  defaultLabel?: string;
}

type PickerHarness = 'prokop' | 'codex-cli' | 'claude-cli';

// Same visual vocabulary as the chat model picker: each model source is
// identified by its brand mark, so identically named models from different
// harnesses (a "Codex" provider in the Prokop catalog vs the Codex CLI) are
// never adjacent or ambiguous. Vertical rail, like the chat picker, so the
// list keeps scaling as harnesses are added.
const HARNESS_TABS: { id: PickerHarness; label: string; Mark: typeof ProkopMark }[] = [
  { id: 'prokop', label: 'Prokop', Mark: ProkopMark },
  { id: 'codex-cli', label: 'Codex', Mark: OpenAIMark },
  { id: 'claude-cli', label: 'Claude', Mark: AnthropicMark },
];

/**
 * Agent model pin picker with a vertical harness-tab rail (mirrors the chat
 * model picker). Each tab shows exactly one catalog (Prokop catalog grouped
 * by provider, or one CLI's flat list), so a pin is always unambiguous about
 * which harness its model belongs to; the trigger shows the pinned harness's
 * brand mark next to the model name. A pin applies only to sessions on its
 * harness; selecting a model always seeds a valid variant (first models.json
 * key or the harness default effort), so a saved pin never carries an
 * unnormalized variant.
 */
export function AgentModelPicker({ models, codexModels, claudeModels, value, onChange, defaultLabel = 'Use server default' }: AgentModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<PickerHarness>(() => (value.modelHarness || 'prokop') as PickerHarness);
  const isMobile = useIsMobile();

  const modelHarness = value.modelHarness || 'prokop';
  const selectedModelObj = value.model && modelHarness === 'prokop'
    ? models.find(m => m.id === value.model) : null;
  const selectedHarnessModel = modelHarness === 'codex-cli'
    ? codexModels.find(m => m.model === value.model)
    : modelHarness === 'claude-cli'
      ? claudeModels.find(m => m.model === value.model)
      : undefined;
  const variantOptions = modelHarness === 'prokop'
    ? (selectedModelObj?.variants ? Object.keys(selectedModelObj.variants) : [])
    : selectedHarnessModel?.supportedEfforts ?? [];

  const availableTabs = HARNESS_TABS.filter(({ id }) =>
    id === 'prokop' ? models.length > 0 : id === 'codex-cli' ? codexModels.length > 0 : claudeModels.length > 0);
  // Opening jumps to the pinned model's tab; afterwards the user switches freely.
  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) setTab((value.modelHarness || 'prokop') as PickerHarness);
  };
  const activeTab = availableTabs.some(t => t.id === tab)
    ? tab
    : availableTabs[0]?.id ?? 'prokop';

  const groupedModels = models.reduce((acc, model) => {
    const key = model.providerName || model.providerId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(model);
    return acc;
  }, {} as Record<string, ModelWithStatus[]>);

  const commit = (next: AgentModelSelection): void => {
    onChange(next);
    setOpen(false);
  };

  const TriggerMark = modelHarness === 'codex-cli' ? OpenAIMark
    : modelHarness === 'claude-cli' ? AnthropicMark : ProkopMark;
  const triggerLabel = selectedModelObj
    ? selectedModelObj.name
    : selectedHarnessModel
      ? `${modelHarness === 'codex-cli' ? 'Codex' : 'Claude'} · ${selectedHarnessModel.name}`
      : null;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange} modal>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-label="Model"
            aria-expanded={open}
            className="w-full justify-between text-sm font-normal h-8"
          >
            <div className="flex items-center gap-2 truncate">
              {triggerLabel
                ? <TriggerMark className="size-4 shrink-0 text-muted-foreground" />
                : <Cpu className="size-4 shrink-0 text-muted-foreground" />}
              {triggerLabel
                ? <span className="truncate">{triggerLabel}</span>
                : <span className="text-muted-foreground">{defaultLabel}</span>
              }
            </div>
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <div className="flex">
            {availableTabs.length > 1 && (
              <div
                role="tablist"
                aria-label="Model source"
                aria-orientation="vertical"
                className={cn(
                  'flex shrink-0 flex-col gap-0.5 border-r border-border p-1',
                  isMobile ? 'w-12 items-center' : 'w-28',
                )}
              >
                {availableTabs.map(({ id, label, Mark }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    aria-label={label}
                    title={isMobile ? label : undefined}
                    onClick={() => setTab(id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-sm text-xs font-medium transition-colors',
                      isMobile ? 'h-9 w-9 justify-center p-0' : 'justify-start px-2 py-1.5',
                      activeTab === id
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Mark className="size-3.5 shrink-0" />
                    {!isMobile && label}
                  </button>
                ))}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Command>
                <CommandInput placeholder="Search models..." autoFocus />
                <CommandList className="max-h-[300px] overflow-y-auto">
                  <CommandEmpty>No model found.</CommandEmpty>
                  <CommandGroup>
                <CommandItem
                  onSelect={() => commit({ model: '', provider: '', variant: '', modelHarness: '' })}
                  className="justify-between"
                >
                  <span className="text-muted-foreground">{defaultLabel}</span>
                  {!value.model && <Check className="size-4" />}
                </CommandItem>
                  </CommandGroup>
                  {activeTab === 'prokop' && Object.entries(groupedModels).map(([providerName, providerModels]) => (
                    <CommandGroup key={providerName} heading={providerName}>
                      {providerModels.map((model) => (
                        <CommandItem
                          key={model.id}
                          value={`${model.name} ${model.id}`}
                          onSelect={() => commit({
                            modelHarness: 'prokop',
                            model: model.id,
                            provider: model.providerId,
                            variant: model.variants ? Object.keys(model.variants)[0] ?? '' : '',
                          })}
                          className="justify-between"
                        >
                          <span className="truncate">{model.name}</span>
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              modelHarness === 'prokop' && value.model === model.id ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  {activeTab === 'codex-cli' && (
                    <CommandGroup>
                      {codexModels.map((model) => (
                        <CommandItem
                          key={model.model}
                          value={`${model.name} ${model.model}`}
                          onSelect={() => commit({
                            modelHarness: 'codex-cli',
                            model: model.model,
                            provider: '',
                            variant: model.defaultEffort,
                          })}
                          className="justify-between"
                        >
                          <span className="truncate">{model.name}</span>
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              modelHarness === 'codex-cli' && value.model === model.model ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  {activeTab === 'claude-cli' && (
                    <CommandGroup>
                      {claudeModels.map((model) => (
                        <CommandItem
                          key={model.model}
                          value={`${model.name} ${model.model}`}
                          onSelect={() => commit({
                            modelHarness: 'claude-cli',
                            model: model.model,
                            provider: '',
                            variant: model.defaultEffort,
                          })}
                          className="justify-between"
                        >
                          <span className="truncate">{model.name}</span>
                          <Check
                            className={cn(
                              'size-4 shrink-0',
                              modelHarness === 'claude-cli' && value.model === model.model ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {variantOptions.length > 0 && (
        <div className="mt-2">
          <Label className="text-sm">{modelHarness === 'prokop' ? 'Variant' : 'Effort'}</Label>
          <Select
            value={variantOptions.includes(value.variant) ? value.variant : variantOptions[0] ?? ''}
            onValueChange={(variant) => onChange({ ...value, variant })}
          >
            <SelectTrigger className="w-full" aria-label={modelHarness === 'prokop' ? 'Variant' : 'Effort'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {variantOptions.map(v => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            {modelHarness === 'prokop'
              ? 'Model variant from models.json (e.g., reasoning effort)'
              : 'Reasoning effort from the harness model catalog'}
          </p>
        </div>
      )}
    </>
  );
}
