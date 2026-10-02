import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { parseAgentLearningSettings } from '@prokopai/sdk';
import { usePreconfigsQuery, useCreatePreconfig, useUpdatePreconfig, useDeletePreconfig, useToolsQuery, useAgentsQuery, useDemoteAgent } from '@/hooks/queries';
import { Layers, Plus, Pencil, Copy, Trash2, ArrowLeft, Loader2, Star, Check, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';
import { LearningSourcePicker } from './LearningSourcePicker';
import { AgentModelPicker } from './AgentModelPicker';

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
  modelHarness?: 'prokop' | 'codex-cli' | 'claude-cli' | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: 'primary' | 'subagent' | 'both';
  canSpawnSubagents?: boolean | string[] | null;
  allowSelfAsSubagent?: boolean;
  skills?: string[] | null;
  capabilities?: { memory?: boolean; skills?: boolean } | null;
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
  modelHarness: '' | 'prokop' | 'codex-cli' | 'claude-cli';
  tools: string[];
  temperature: string;
  canSpawnSubagentsMode: 'all' | 'none' | 'specific';
  canSpawnSubagentsList: string[];
  allowSelfAsSubagent: boolean;
  skills: string[];
  isDefault: boolean;
  capabilityMemory: boolean;
  capabilitySkills: boolean;
  learningEnabled: boolean;
  learningIdle: string;
  learningMinInterval: string;
  learningMaxPending: string;
  learningInstructions: string;
  learningSourcesMode: 'all' | 'selected';
  learningSourceIds: string[];
}

const emptyForm: PreconfigForm = {
  name: '',
  description: '',
  systemPrompt: '',
  mode: 'primary' as const,
  model: '',
  provider: '',
  variant: '',
  modelHarness: '',
  tools: [],
  temperature: '',
  canSpawnSubagentsMode: 'none',
  canSpawnSubagentsList: [],
  allowSelfAsSubagent: false,
  skills: [],
  isDefault: false,
  capabilityMemory: true,
  capabilitySkills: true,
  learningEnabled: true,
  learningIdle: '',
  learningMinInterval: '',
  learningMaxPending: '',
  learningInstructions: '',
  learningSourcesMode: 'all' as const,
  learningSourceIds: [],
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

  const agentsData = useAgentsQuery(sdkClient);
  const demoteMut = useDemoteAgent(sdkClient);
  const agentIds = new Set((agentsData.data?.agents ?? []).map(agent => agent.id));
  const isMaterialized = editingPreconfig ? agentIds.has(editingPreconfig.id) : false;
  const [demoteTarget, setDemoteTarget] = useState<string | null>(null);
  const [demoting, setDemoting] = useState(false);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeSaving, setHomeSaving] = useState(false);
  const [homeDraft, setHomeDraft] = useState({ user: '', memory: '' });
  const [homeSkills, setHomeSkills] = useState<Array<{ name: string; description: string }>>([]);

  const models = useServerDataStore((s) => s.models);
  const workspaces = useServerDataStore((s) => s.workspaces);

  // Harness catalogs for cross-harness model pins. A missing or unavailable
  // CLI yields an empty list and simply hides that picker group.
  const codexCatalog = useQuery({
    queryKey: ['codex-catalog'],
    queryFn: () => sdkClient!.http.sessions.codexCatalog(),
    enabled: !!sdkClient,
    staleTime: 60_000,
    retry: false,
  });
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog'],
    queryFn: () => sdkClient!.http.sessions.claudeCatalog(),
    enabled: !!sdkClient,
    staleTime: 60_000,
    retry: false,
  });
  const codexCatalogModels = codexCatalog.data?.models ?? [];
  const claudeCatalogModels = claudeCatalog.data?.models ?? [];


  const availableSubagents = preconfigs.filter(p => {
    const mode = p.mode ?? 'primary';
    const isSubagent = mode === 'subagent' || mode === 'both';
    const isNotSelf = !editingPreconfig || p.id !== editingPreconfig.id;
    return isSubagent && isNotSelf;
  });

  useEffect(() => {
    if (toolsData?.tools) {
      // Domain tools (memory, skills, search, scheduler, task)
      // are gated by workspace capability toggles, not preconfig tool
      // selection; selecting them here would do nothing.
      setAvailableTools(toolsData.tools.filter(tool => tool.source !== 'domain'));
    }
  }, [toolsData]);

  // Load the materialized agent's memory files and personal skills for the
  // Home section. Local draft state; saving goes through the memory API.
  useEffect(() => {
    if (!editingPreconfig || !isMaterialized || !sdkClient) {
      setHomeDraft({ user: '', memory: '' });
      setHomeSkills([]);
      setHomeError(null);
      return;
    }
    let cancelled = false;
    setHomeLoading(true);
    setHomeError(null);
    Promise.all([
      sdkClient.http.agents.getMemory(editingPreconfig.id),
      sdkClient.http.agents.listSkills(editingPreconfig.id),
    ])
      .then(([memory, skills]) => {
        if (cancelled) return;
        setHomeDraft({ user: memory.user ?? '', memory: memory.memory ?? '' });
        setHomeSkills(skills.skills ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setHomeError(err instanceof Error ? err.message : 'Failed to load agent home');
      })
      .finally(() => {
        if (!cancelled) setHomeLoading(false);
      });
    return () => { cancelled = true; };
  }, [editingPreconfig?.id, isMaterialized, sdkClient]);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingPreconfig(null);
    setForm(emptyForm);
    setCustomToolInput('');
    setSubagentInput('');
    setSkillInput('');
  };

  const handleEdit = (preconfig: Preconfig) => {
    setEditingPreconfig(preconfig);
    setIsCreating(false);
    const learning = parseAgentLearningSettings(preconfig.settings);
    setForm({
      name: preconfig.name,
      description: preconfig.description || '',
      systemPrompt: preconfig.systemPrompt || '',
      mode: preconfig.mode || 'primary',
      model: preconfig.model || '',
      provider: preconfig.provider || '',
      variant: preconfig.variant || '',
      modelHarness: preconfig.modelHarness ?? '',
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
      capabilityMemory: preconfig.capabilities?.memory !== false,
      capabilitySkills: preconfig.capabilities?.skills !== false,
      learningEnabled: learning?.enabled ?? true,
      learningIdle: learning?.cadence ? String(learning.cadence.idleMinutes) : '',
      learningMinInterval: learning?.cadence ? String(learning.cadence.minimumIntervalMinutes) : '',
      learningMaxPending: learning?.cadence ? String(learning.cadence.maximumPendingMinutes) : '',
      learningInstructions: learning?.instructions ?? '',
      learningSourcesMode: learning?.sources.mode === 'selected' ? 'selected' : 'all',
      learningSourceIds: learning?.sources.mode === 'selected' ? learning.sources.workspaceIds : [],
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
      // Preserve settings keys owned elsewhere (e.g. learning) instead of
      // replacing the whole bag with temperature only.
      const settings: Record<string, unknown> = { ...(editingPreconfig?.settings ?? {}) };
      if (form.temperature.trim()) {
        const temp = parseFloat(form.temperature);
        if (isNaN(temp) || temp < 0.1 || temp > 0.9) {
          setError('Temperature must be between 0.1 and 0.9');
          setSaving(false);
          return;
        }
        settings.temperature = temp;
      } else {
        delete settings.temperature;
      }

      if (form.mode !== 'subagent') {
        const idle = form.learningIdle.trim();
        const minInterval = form.learningMinInterval.trim();
        const maxPending = form.learningMaxPending.trim();
        let cadence: { idleMinutes: number; minimumIntervalMinutes: number; maximumPendingMinutes: number } | null = null;
        if (idle || minInterval || maxPending) {
          const minutes = (value: string) => Number.parseInt(value, 10);
          if (!idle || !minInterval || !maxPending
            || ![idle, minInterval, maxPending].every(value => /^\d+$/.test(value))
            || minutes(idle) < 1 || minutes(minInterval) < 1
            || minutes(maxPending) < minutes(minInterval)) {
            setError('Learning cadence needs three positive minute values (idle, minimum interval, maximum window), with the maximum at least the minimum');
            setSaving(false);
            return;
          }
          cadence = {
            idleMinutes: minutes(idle),
            minimumIntervalMinutes: minutes(minInterval),
            maximumPendingMinutes: minutes(maxPending),
          };
        }
        settings.learning = {
          enabled: form.learningEnabled,
          cadence,
          instructions: form.learningInstructions,
          sources: form.learningSourcesMode === 'all'
            ? { mode: 'all' }
            : { mode: 'selected', workspaceIds: form.learningSourceIds },
        };
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
        modelHarness: form.modelHarness || null,
        tools: form.tools.length > 0 ? form.tools : null,
        settings: Object.keys(settings).length > 0 ? settings : null,
        canSpawnSubagents,
        allowSelfAsSubagent: form.allowSelfAsSubagent,
        skills: form.skills.length > 0 ? form.skills : null,
        ...(form.mode !== 'subagent'
          ? { capabilities: { memory: form.capabilityMemory, skills: form.capabilitySkills } }
          : {}),
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
      setError(err instanceof Error ? err.message : 'Failed to save agent');
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
        modelHarness: preconfig.modelHarness ?? null,
        tools: preconfig.tools,
        settings: preconfig.settings,
        canSpawnSubagents: preconfig.canSpawnSubagents ?? false,
        allowSelfAsSubagent: preconfig.allowSelfAsSubagent ?? false,
        skills: preconfig.skills,
        format: 'md',
      });
      toast.success(`Duplicated agent as ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to duplicate agent';
      setError(message);
      toast.error('Failed to duplicate agent', { description: message });
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
      const message = err instanceof Error ? err.message : 'Failed to delete agent';
      setError(message);
      toast.error('Failed to delete agent', { description: message });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveHomeMemory = async () => {
    if (!editingPreconfig || !sdkClient) return;
    setHomeSaving(true);
    setHomeError(null);
    try {
      await sdkClient.http.agents.updateMemory(editingPreconfig.id, { target: 'user', content: homeDraft.user });
      await sdkClient.http.agents.updateMemory(editingPreconfig.id, { target: 'memory', content: homeDraft.memory });
      toast.success('Agent memory saved');
    } catch (err) {
      setHomeError(err instanceof Error ? err.message : 'Failed to save agent memory');
    } finally {
      setHomeSaving(false);
    }
  };

  const handleDemote = async () => {
    if (!demoteTarget) return;
    setDemoting(true);
    try {
      await demoteMut.mutateAsync(demoteTarget);
      setDemoteTarget(null);
      toast.success('Removed agent home and memory');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove agent home';
      toast.error('Failed to remove agent home', { description: message });
    } finally {
      setDemoting(false);
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingPreconfig(null);
    setForm(emptyForm);
    setCustomToolInput('');
    setSubagentInput('');
    setSkillInput('');
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
              {isCreating ? 'New Agent' : `Edit: ${editingPreconfig?.name}`}
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
              <AgentModelPicker
                models={models}
                codexModels={codexCatalogModels}
                claudeModels={claudeCatalogModels}
                value={{
                  model: form.model,
                  provider: form.provider,
                  variant: form.variant,
                  modelHarness: form.modelHarness,
                }}
                onChange={(next) => setForm(prev => ({ ...prev, ...next }))}
              />
              <p className="text-[10px] text-muted-foreground">
                Provider is set automatically based on the selected model
              </p>
            </div>
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

          {form.mode !== 'subagent' && (
            <>
              <Separator className="my-1" />

              <div className="space-y-2">
                <Label className="text-sm">Capabilities</Label>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">Memory</p>
                    <p className="text-[10px] text-muted-foreground">
                      Personal memory (agent_memory) that travels with this agent across all workspaces.
                    </p>
                  </div>
                  <Switch
                    checked={form.capabilityMemory}
                    onCheckedChange={(checked) => setForm({ ...form, capabilityMemory: checked })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm">Skill management</p>
                    <p className="text-[10px] text-muted-foreground">
                      Lets this agent maintain its own skills (agent_skill_manage).
                    </p>
                  </div>
                  <Switch
                    checked={form.capabilitySkills}
                    onCheckedChange={(checked) => setForm({ ...form, capabilitySkills: checked })}
                  />
                </div>
              </div>

              <Separator className="my-1" />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label className="text-sm">Learning</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Reviews this agent's sessions when idle and saves durable lessons to its personal memory.
                    </p>
                  </div>
                  <Switch
                    checked={form.learningEnabled}
                    onCheckedChange={(checked) => setForm({ ...form, learningEnabled: checked })}
                  />
                </div>
                {form.learningEnabled && (
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Cadence in minutes (leave empty for defaults)</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          value={form.learningIdle}
                          onChange={(e) => setForm({ ...form, learningIdle: e.target.value })}
                          placeholder="Idle"
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number"
                          min={1}
                          value={form.learningMinInterval}
                          onChange={(e) => setForm({ ...form, learningMinInterval: e.target.value })}
                          placeholder="Min interval"
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number"
                          min={1}
                          value={form.learningMaxPending}
                          onChange={(e) => setForm({ ...form, learningMaxPending: e.target.value })}
                          placeholder="Max window"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Reviewer instructions</p>
                      <textarea
                        value={form.learningInstructions}
                        onChange={(e) => setForm({ ...form, learningInstructions: e.target.value })}
                        className="w-full h-16 p-2 rounded-md border bg-background text-xs resize-y"
                        placeholder="What this agent should focus on when learning..."
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Which workspaces feed this agent's learning</p>
                      <select
                        value={form.learningSourcesMode}
                        onChange={(e) => setForm({ ...form, learningSourcesMode: e.target.value as 'all' | 'selected' })}
                        className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                      >
                        <option value="all">All workspaces</option>
                        <option value="selected">Selected workspaces</option>
                      </select>
                      {form.learningSourcesMode === 'selected' && (
                        <LearningSourcePicker
                          workspaces={workspaces}
                          selectedIds={form.learningSourceIds}
                          onChange={(ids) => setForm({ ...form, learningSourceIds: ids })}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

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
                    placeholder="Agent ID..."
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

          {editingPreconfig && isMaterialized && (
            <>
              <Separator className="my-1" />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Home & Memory</Label>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      // Re-run the loader by toggling the dependency through a refetch of agents.
                      agentsData.refetch();
                    }}
                    title="Reload home data"
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                </div>
                {homeError && (
                  <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{homeError}</div>
                )}
                {homeLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] text-muted-foreground">User preferences (USER.md)</p>
                      <textarea
                        value={homeDraft.user}
                        onChange={(e) => setHomeDraft({ ...homeDraft, user: e.target.value })}
                        className="w-full h-20 p-2 rounded-md border bg-background text-xs font-mono resize-y"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Memory (MEMORY.md)</p>
                      <textarea
                        value={homeDraft.memory}
                        onChange={(e) => setHomeDraft({ ...homeDraft, memory: e.target.value })}
                        className="w-full h-28 p-2 rounded-md border bg-background text-xs font-mono resize-y"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button size="sm" variant="outline" onClick={handleSaveHomeMemory} disabled={homeSaving}>
                        {homeSaving ? <Loader2 className="size-3 animate-spin" /> : 'Save memory'}
                      </Button>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        Personal skills ({homeSkills.length}) — read-only; the agent manages them at runtime.
                      </p>
                      {homeSkills.length > 0 && (
                        <div className="rounded-md border divide-y">
                          {homeSkills.map((skill) => (
                            <div key={skill.name} className="px-2.5 py-1.5">
                              <p className="font-mono text-xs truncate">{skill.name}</p>
                              {skill.description && (
                                <p className="text-[10px] text-muted-foreground line-clamp-1">{skill.description}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDemoteTarget(editingPreconfig.id)}
                      >
                        <Trash2 className="size-3" />
                        Remove home & memory
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
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
          {preconfigs.length} agent{preconfigs.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-3" />
          <span className="hidden sm:inline">New Agent</span>
        </Button>
      </div>

      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      {preconfigs.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No agents yet. Create one to get started.
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
                  title="Edit agent"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleDuplicate(preconfig)}
                  disabled={duplicatingId !== null}
                  title="Duplicate agent"
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
                    title="Delete agent"
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
        title="Delete Agent"
        description="Are you sure you want to delete this agent? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />

      <ConfirmDialog
        open={demoteTarget !== null}
        onOpenChange={(open) => { if (!open) setDemoteTarget(null); }}
        title="Remove Home & Memory"
        description="This removes the agent directory and its home workspace. Sessions created in the home workspace will be deleted. The agent definition is preserved."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleDemote}
        loading={demoting}
      />
    </div>
  );
}
