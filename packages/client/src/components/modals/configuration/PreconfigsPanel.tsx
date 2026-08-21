import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import type { ProkopaiClient, ModelWithStatus } from '@prokopai/sdk';
import { usePreconfigsQuery, useCreatePreconfig, useUpdatePreconfig, useDeletePreconfig, useToolsQuery } from '@/hooks/queries';
import { Layers, Plus, Pencil, Copy, Trash2, ArrowLeft, Loader2, Star, Check, X, Cpu, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
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
import { useServerDataStore } from '@/stores/serverDataStore';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

interface Preconfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  provider: string | null;
  variant?: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: 'primary' | 'subagent' | 'both';
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  skills?: string[] | null;
}

const MODE_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'subagent', label: 'Subagent' },
  { value: 'both', label: 'Both' },
];

function getDuplicateName(name: string, existingNames: string[]): string {
  const names = new Set(existingNames);
  const copyName = `${name} Copy`;
  if (!names.has(copyName)) return copyName;

  let copyNumber = 2;
  while (names.has(`${copyName} ${copyNumber}`)) {
    copyNumber += 1;
  }
  return `${copyName} ${copyNumber}`;
}

interface PreconfigForm {
  name: string;
  description: string;
  systemPrompt: string;
  mode: 'primary' | 'subagent' | 'both';
  model: string;
  provider: string;
  variant: string;
  tools: string[];
  temperature: string;
  canSpawnSubagentsMode: 'all' | 'none' | 'specific';
  canSpawnSubagentsList: string[];
  allowSelfAsSubagent: boolean;
  skills: string[];
  isDefault: boolean;
}

const emptyForm: PreconfigForm = {
  name: '',
  description: '',
  systemPrompt: '',
  mode: 'primary' as const,
  model: '',
  provider: '',
  variant: '',
  tools: [],
  temperature: '',
  canSpawnSubagentsMode: 'none',
  canSpawnSubagentsList: [],
  allowSelfAsSubagent: false,
  skills: [],
  isDefault: false,
};

export function PreconfigsPanel({ sdkClient }: PanelProps) {
  const { data: preconfigsData, isLoading: loading } = usePreconfigsQuery(sdkClient);
  const { data: toolsData } = useToolsQuery(sdkClient);
  const createPreconfigMut = useCreatePreconfig(sdkClient);
  const updatePreconfigMut = useUpdatePreconfig(sdkClient);
  const deletePreconfigMut = useDeletePreconfig(sdkClient);
  const preconfigs: Preconfig[] = (preconfigsData?.preconfigs ?? []) as Preconfig[];
  const [error, setError] = useState<string | null>(null);

  const [editingPreconfig, setEditingPreconfig] = useState<Preconfig | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string }[]>([]);
  const [customToolInput, setCustomToolInput] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [subagentInput, setSubagentInput] = useState('');
  const [skillInput, setSkillInput] = useState('');

  const models = useServerDataStore((s) => s.models);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const selectedModelObj = form.model ? models.find(m => m.id === form.model) : null;
  const selectedModelVariants = selectedModelObj?.variants ? Object.keys(selectedModelObj.variants) : [];


  const groupedModels = models.reduce((acc, model) => {
    const key = model.providerName || model.providerId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(model);
    return acc;
  }, {} as Record<string, ModelWithStatus[]>);

  const availableSubagents = preconfigs.filter(p => {
    const mode = p.mode ?? 'primary';
    const isSubagent = mode === 'subagent' || mode === 'both';
    const isNotSelf = !editingPreconfig || p.id !== editingPreconfig.id;
    return isSubagent && isNotSelf;
  });

  useEffect(() => {
    if (toolsData?.tools) {
      setAvailableTools(toolsData.tools);
    }
  }, [toolsData]);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingPreconfig(null);
    setForm(emptyForm);
    setCustomToolInput('');
    setSubagentInput('');
    setSkillInput('');
    setModelSelectorOpen(false);
  };

  const handleEdit = (preconfig: Preconfig) => {
    setEditingPreconfig(preconfig);
    setIsCreating(false);
    setForm({
      name: preconfig.name,
      description: preconfig.description || '',
      systemPrompt: preconfig.systemPrompt || '',
      mode: preconfig.mode || 'primary',
      model: preconfig.model || '',
      provider: preconfig.provider || '',
      variant: preconfig.variant || '',
      tools: preconfig.tools ?? [],
      temperature: preconfig.settings?.temperature != null
        ? String(preconfig.settings.temperature)
        : '',
      canSpawnSubagentsMode: preconfig.canSpawnSubagents === true ? 'all'
        : preconfig.canSpawnSubagents === false || preconfig.canSpawnSubagents === null || preconfig.canSpawnSubagents === undefined
          ? 'none'
          : 'specific',
      canSpawnSubagentsList: Array.isArray(preconfig.canSpawnSubagents) ? preconfig.canSpawnSubagents : [],
      allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
      skills: preconfig.skills ?? [],
      isDefault: preconfig.isDefault,
    });
    setCustomToolInput('');
    setSubagentInput('');
    setSkillInput('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      let settings: Record<string, unknown> | null = null;
      if (form.temperature.trim()) {
        const temp = parseFloat(form.temperature);
        if (isNaN(temp) || temp < 0.1 || temp > 0.9) {
          setError('Temperature must be between 0.1 and 0.9');
          setSaving(false);
          return;
        }
        settings = { temperature: temp };
      }

      let canSpawnSubagents: boolean | string[] | null = null;
      if (form.canSpawnSubagentsMode === 'all') {
        canSpawnSubagents = true;
      } else if (form.canSpawnSubagentsMode === 'specific') {
        canSpawnSubagents = form.canSpawnSubagentsList.length > 0 ? form.canSpawnSubagentsList : [];
      } else {
        canSpawnSubagents = false;
      }

      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        systemPrompt: form.systemPrompt,
        mode: form.mode,
        model: form.model.trim() || null,
        provider: form.provider.trim() || null,
        variant: form.variant.trim() || null,
        tools: form.tools.length > 0 ? form.tools : null,
        settings,
        canSpawnSubagents,
        allowSelfAsSubagent: form.allowSelfAsSubagent,
        skills: form.skills.length > 0 ? form.skills : null,
        isDefault: form.isDefault,
        format: 'md',
      };

      if (isCreating) {
        await createPreconfigMut.mutateAsync(body);
      } else if (editingPreconfig) {
        await updatePreconfigMut.mutateAsync({ id: editingPreconfig.id, body });
      }
      setIsCreating(false);
      setEditingPreconfig(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preconfig');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (preconfig: Preconfig) => {
    if (duplicatingId !== null) return;

    const name = getDuplicateName(preconfig.name, preconfigs.map(({ name }) => name));
    setDuplicatingId(preconfig.id);
    setError(null);
    try {
      await createPreconfigMut.mutateAsync({
        name,
        description: preconfig.description,
        systemPrompt: preconfig.systemPrompt,
        mode: preconfig.mode,
        model: preconfig.model,
        provider: preconfig.provider,
        variant: preconfig.variant,
        tools: preconfig.tools,
        settings: preconfig.settings,
        canSpawnSubagents: preconfig.canSpawnSubagents ?? false,
        allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
        skills: preconfig.skills,
        format: 'md',
      });
      toast.success(`Duplicated preconfig as ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate preconfig';
      setError(message);
      toast.error('Failed to duplicate preconfig', { description: message });
    } finally {
      setDuplicatingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePreconfigMut.mutateAsync(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete preconfig';
      setError(message);
      toast.error('Failed to delete preconfig', { description: message });
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingPreconfig(null);
    setForm(emptyForm);
    setCustomToolInput('');
    setSubagentInput('');
    setSkillInput('');
    setModelSelectorOpen(false);
  };

  if (isCreating || editingPreconfig) {
    return (
      <div className="p-3 sm:p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleCancel}>
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="text-sm font-medium">
              {isCreating ? 'New Preconfig' : `Edit: ${editingPreconfig?.name}`}
            </h3>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving || !form.name.trim()}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
          </Button>
        </div>

        {error && (
          <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Agent"
            />
          </div>
          <div>
            <Label className="text-sm">Description</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description..."
            />
          </div>
          <div>
            <Label className="text-sm">Mode</Label>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as 'primary' | 'subagent' | 'both' })}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <Label className="text-sm">Model</Label>
              <Popover open={modelSelectorOpen} onOpenChange={setModelSelectorOpen} modal>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelSelectorOpen}
                    className="w-full justify-between font-mono text-sm h-9"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Cpu className="size-4 shrink-0 text-muted-foreground" />
                      {selectedModelObj
                        ? <span className="truncate">{selectedModelObj.name}</span>
                        : <span className="text-muted-foreground">Use server default</span>
                      }
                    </div>
                    <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search models..." />
                    <CommandList className="max-h-[300px] overflow-y-auto">
                      <CommandEmpty>No model found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setForm(prev => ({ ...prev, model: '', provider: '', variant: '' }));
                            setModelSelectorOpen(false);
                          }}
                          className="justify-between"
                        >
                          <span className="text-muted-foreground">Use server default</span>
                          {!form.model && <Check className="size-4" />}
                        </CommandItem>
                      </CommandGroup>
                      {Object.entries(groupedModels).map(([providerName, providerModels]) => (
                        <CommandGroup key={providerName} heading={providerName}>
                          {providerModels.map((model) => (
                            <CommandItem
                              key={model.id}
                              value={`${model.name} ${model.id}`}
                              onSelect={() => {
                                setForm(prev => ({
                                  ...prev,
                                  model: model.id,
                                  provider: model.providerId,
                                  variant: '',
                                }));
                                setModelSelectorOpen(false);
                              }}
                              className="justify-between"
                            >
                              <span className="truncate">{model.name}</span>
                              <Check
                                className={cn(
                                  'size-4 shrink-0',
                                  form.model === model.id ? 'opacity-100' : 'opacity-0',
                                )}
                              />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-[10px] text-muted-foreground">
                Provider is set automatically based on the selected model
              </p>
            </div>

            {selectedModelVariants.length > 0 && (
              <div>
                <Label className="text-sm">Variant</Label>
                <select
                  value={form.variant}
                  onChange={(e) => setForm(prev => ({ ...prev, variant: e.target.value }))}
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Default</option>
                  {selectedModelVariants.map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Model variant from models.json (e.g., reasoning effort)
                </p>
              </div>
            )}
          </div>

          <Separator className="my-1" />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Default Preconfig</Label>
              <p className="text-[10px] text-muted-foreground">Only one preconfig can be the default</p>
            </div>
            <Switch
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
            />
          </div>

          <Separator className="my-1" />

          <div className="space-y-2">
            <Label className="text-sm">Tools</Label>
            <p className="text-[10px] text-muted-foreground">
              {form.tools.length === 0 ? 'No tools selected — all available tools will be enabled' : `${form.tools.length} tool${form.tools.length !== 1 ? 's' : ''} selected`}
            </p>

            <Input
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              placeholder="Search tools..."
              className="h-8 text-xs"
            />

            <div className="dialog-scrollbar max-h-[200px] overflow-y-auto rounded-md border">
              {[...availableTools]
                .sort((a, b) => a.name.localeCompare(b.name))
                .filter(tool =>
                  !toolSearch.trim()
                  || tool.name.toLowerCase().includes(toolSearch.toLowerCase())
                  || tool.description?.toLowerCase().includes(toolSearch.toLowerCase())
                )
                .map(tool => {
                  const selected = form.tools.includes(tool.name);
                  return (
                    <button
                      key={tool.name}
                      type="button"
                      onClick={() => setForm(prev => ({
                        ...prev,
                        tools: selected
                          ? prev.tools.filter(t => t !== tool.name)
                          : [...prev.tools, tool.name],
                      }))}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                        selected && 'bg-primary/10',
                      )}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="font-mono text-xs truncate">{tool.name}</span>
                        {tool.description && (
                          <span className="text-[10px] text-muted-foreground truncate">{tool.description}</span>
                        )}
                      </div>
                      <div className={cn(
                        'flex size-4 shrink-0 items-center justify-center rounded border',
                        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30',
                      )}>
                        {selected && <Check className="size-3" />}
                      </div>
                    </button>
                  );
                })}
            </div>

            <div className="flex gap-1.5">
              <Input
                value={customToolInput}
                onChange={(e) => setCustomToolInput(e.target.value)}
                placeholder="Add custom tool ID..."
                className="h-7 text-xs font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customToolInput.trim()) {
                    e.preventDefault();
                    const id = customToolInput.trim();
                    if (!form.tools.includes(id)) {
                      setForm(prev => ({ ...prev, tools: [...prev.tools, id] }));
                    }
                    setCustomToolInput('');
                  }
                }}
              />
            </div>
          </div>

          <Separator className="my-1" />

          <div>
            <Label className="text-sm">Temperature</Label>
            <p className="text-[10px] text-muted-foreground">
              Model sampling temperature (0.1–0.9). Leave empty to use server default.
            </p>
            <Input
              type="number"
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: e.target.value })}
              placeholder="0.2"
              min="0.1"
              max="0.9"
              step="0.1"
              className="font-mono"
            />
          </div>

          <Separator className="my-1" />

          <div className="space-y-2">
            <Label className="text-sm">Can Spawn Subagents</Label>
            <select
              value={form.canSpawnSubagentsMode}
              onChange={(e) => setForm({ ...form, canSpawnSubagentsMode: e.target.value as 'all' | 'none' | 'specific' })}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="none">No — cannot spawn subagents</option>
              <option value="all">Yes — all available subagents</option>
              <option value="specific">Specific — choose which subagents</option>
            </select>

            {form.canSpawnSubagentsMode === 'specific' && (
              <div className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground">
                  Select from available subagents or enter a preconfig ID manually
                </p>

                {/* Badge selector for known subagents */}
                {availableSubagents.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {availableSubagents.map(subagent => {
                      const selected = form.canSpawnSubagentsList.includes(subagent.id);
                      return (
                        <button
                          key={subagent.id}
                          type="button"
                          onClick={() => {
                            setForm(prev => ({
                              ...prev,
                              canSpawnSubagentsList: selected
                                ? prev.canSpawnSubagentsList.filter(s => s !== subagent.id)
                                : [...prev.canSpawnSubagentsList, subagent.id],
                            }));
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border transition-colors ${
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background border-border hover:bg-muted'
                          }`}
                          title={subagent.description || subagent.id}
                        >
                          {selected && <Check className="size-2.5" />}
                          {subagent.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Manual ID input */}
                <div className="flex gap-1.5">
                  <Input
                    value={subagentInput}
                    onChange={(e) => setSubagentInput(e.target.value)}
                    placeholder="Preconfig ID..."
                    className="h-7 text-xs font-mono"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && subagentInput.trim()) {
                        e.preventDefault();
                        const id = subagentInput.trim();
                        if (!form.canSpawnSubagentsList.includes(id)) {
                          setForm(prev => ({ ...prev, canSpawnSubagentsList: [...prev.canSpawnSubagentsList, id] }));
                        }
                        setSubagentInput('');
                      }
                    }}
                  />
                </div>

                {/* Show manually-added IDs that don't match known subagents */}
                {form.canSpawnSubagentsList.filter(id => !availableSubagents.some(sa => sa.id === id)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.canSpawnSubagentsList.filter(id => !availableSubagents.some(sa => sa.id === id)).map(id => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 border border-primary/30 font-mono"
                      >
                        {id}
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({
                            ...prev,
                            canSpawnSubagentsList: prev.canSpawnSubagentsList.filter(s => s !== id),
                          }))}
                          className="hover:text-destructive"
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="allow-self-as-subagent" className="text-sm">Allow Self as Subagent</Label>
              <p className="text-[10px] text-muted-foreground">
                Allows this preconfig to delegate once to a new agent using the same preconfig. It cannot repeat again in that subagent chain.
              </p>
              {form.canSpawnSubagentsMode === 'none' && (
                <p className="text-[10px] text-muted-foreground">Enable subagent spawning first.</p>
              )}
              {form.mode === 'primary' && (
                <p className="text-[10px] text-muted-foreground">This setting has no effect while the mode is Primary.</p>
              )}
            </div>
            <Switch
              id="allow-self-as-subagent"
              checked={form.allowSelfAsSubagent}
              disabled={form.canSpawnSubagentsMode === 'none'}
              onCheckedChange={(checked) => setForm({ ...form, allowSelfAsSubagent: checked })}
            />
          </div>

          <Separator className="my-1" />

          <div className="space-y-2">
            <Label className="text-sm">Skills</Label>
            <p className="text-[10px] text-muted-foreground">
              {form.skills.length === 0 ? 'No skills selected — all available skills will be enabled' : `${form.skills.length} skill${form.skills.length !== 1 ? 's' : ''} selected`}
            </p>
            <div className="flex gap-1.5">
              <Input
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                placeholder="Skill name..."
                className="h-7 text-xs font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && skillInput.trim()) {
                    e.preventDefault();
                    const name = skillInput.trim();
                    if (!form.skills.includes(name)) {
                      setForm(prev => ({ ...prev, skills: [...prev.skills, name] }));
                    }
                    setSkillInput('');
                  }
                }}
              />
            </div>
            {form.skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.skills.map(skill => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 border border-primary/30"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, skills: prev.skills.filter(s => s !== skill) }))}
                      className="hover:text-destructive"
                    >
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <Separator className="my-1" />

          <div>
            <Label className="text-sm">System Prompt</Label>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              className="w-full h-48 p-3 rounded-lg border bg-background text-sm resize-y"
              placeholder="System prompt content..."
            />
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {preconfigs.length} preconfig{preconfigs.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-3" />
          <span className="hidden sm:inline">New Preconfig</span>
        </Button>
      </div>

      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      {preconfigs.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No preconfigs yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {preconfigs.map((preconfig) => (
            <div
              key={preconfig.id}
              className="flex items-center justify-between p-2.5 sm:p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
              onClick={() => handleEdit(preconfig)}
            >
              <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                <Layers className="size-4 text-muted-foreground shrink-0 hidden sm:block" />
                <div className="flex flex-col flex-1 min-w-0 gap-0.5 sm:gap-1 overflow-hidden">
                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{preconfig.name}</span>
                    {preconfig.isDefault && (
                      <Badge variant="default" className="text-[10px] px-1 sm:px-1.5 py-0">
                        <Star className="size-2.5 sm:mr-0.5" />
                        <span className="hidden sm:inline">Default</span>
                      </Badge>
                    )}
                    {preconfig.mode && preconfig.mode !== 'primary' && (
                      <Badge variant="secondary" className="text-[10px] px-1 sm:px-1.5 py-0">
                        <span className="hidden sm:inline">{preconfig.mode}</span>
                        <span className="sm:hidden">{preconfig.mode === 'subagent' ? 'SA' : 'B'}</span>
                      </Badge>
                    )}
                  </div>
                  {preconfig.description && (
                    <div className="text-xs text-muted-foreground line-clamp-1">{preconfig.description}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 sm:gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleEdit(preconfig)}
                  title="Edit preconfig"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleDuplicate(preconfig)}
                  disabled={duplicatingId !== null}
                  title="Duplicate preconfig"
                >
                  {duplicatingId === preconfig.id
                    ? <Loader2 className="size-3 animate-spin" />
                    : <Copy className="size-3" />}
                </Button>
                {!preconfig.isDefault && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => setDeleteTarget(preconfig.id)}
                    title="Delete preconfig"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Preconfig"
        description="Are you sure you want to delete this preconfig? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}
