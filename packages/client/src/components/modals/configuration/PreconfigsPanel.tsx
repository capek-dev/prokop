import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { defaultLearningCadence, parseAgentLearningSettings } from '@prokopai/sdk';
import { usePreconfigsQuery, useCreatePreconfig, useUpdatePreconfig, useDeletePreconfig, useToolsQuery, useAgentsQuery, useDemoteAgent } from '@/hooks/queries';
import { Plus, Copy, Trash2, Loader2, Star, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useServerDataStore } from '@/stores/serverDataStore';
import { LearningSourcePicker } from './LearningSourcePicker';
import { LearningHistory } from './LearningHistory';
import { AgentModelPicker } from './AgentModelPicker';
import { DisclosureRow } from './DisclosureRow';
import { MemorySkillsControls } from './MemorySkillsControls';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsEditorHeader, SettingsEmpty, SettingsError, SettingsListRow, SettingsLoading } from './SettingsPrimitives';

/** An open agent editor. `id` is null for a new agent; `initial` detects unsaved edits. */
export interface AgentEditorDraft {
  id: string | null;
  form: PreconfigForm;
  initial: PreconfigForm;
}

interface PanelProps {
  sdkClient: ProkopaiClient | null;
  /** Lifted by the settings dialog so an open editor survives switching sections. */
  draft?: AgentEditorDraft | null;
  onDraftChange?: Dispatch<SetStateAction<AgentEditorDraft | null>>;
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

const LEARNING_DEFAULTS = defaultLearningCadence('agent');
const LEARNING_FIELDS = [
  { key: 'learningIdle', label: 'Quiet period', defaultValue: LEARNING_DEFAULTS.idleMinutes },
  { key: 'learningMinInterval', label: 'Min interval', defaultValue: LEARNING_DEFAULTS.minimumIntervalMinutes },
  { key: 'learningMaxPending', label: 'Max pending age', defaultValue: LEARNING_DEFAULTS.maximumPendingMinutes },
] as const;

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

export interface PreconfigForm {
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

export function PreconfigsPanel({ sdkClient, draft: draftProp, onDraftChange }: PanelProps) {
  const { data: preconfigsData, isLoading: loading } = usePreconfigsQuery(sdkClient);
  const { data: toolsData } = useToolsQuery(sdkClient);
  const createPreconfigMut = useCreatePreconfig(sdkClient);
  const updatePreconfigMut = useUpdatePreconfig(sdkClient);
  const deletePreconfigMut = useDeletePreconfig(sdkClient);
  const preconfigs: Preconfig[] = (preconfigsData?.preconfigs ?? []) as Preconfig[];
  const [error, setError] = useState<string | null>(null);

  const [localDraft, setLocalDraft] = useState<AgentEditorDraft | null>(null);
  const draft = onDraftChange ? (draftProp ?? null) : localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const isCreating = draft !== null && draft.id === null;
  const editingPreconfig = draft?.id ? preconfigs.find(p => p.id === draft.id) ?? null : null;
  const form = draft?.form ?? emptyForm;
  const setForm = (next: PreconfigForm | ((prev: PreconfigForm) => PreconfigForm)) =>
    setDraft(current => current && { ...current, form: typeof next === 'function' ? next(current.form) : next });
  const isDirty = draft !== null && JSON.stringify(draft.form) !== JSON.stringify(draft.initial);
  /** Codex and Claude pins run on their own CLI, which ignores Prokop tools, subagents, and temperature. */
  const externalHarness = form.modelHarness === 'codex-cli' ? 'Codex CLI'
    : form.modelHarness === 'claude-cli' ? 'Claude CLI' : null;
  const [discardOpen, setDiscardOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string }[]>([]);
  const [toolSearch, setToolSearch] = useState('');

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
  const [homeReload, setHomeReload] = useState(0);

  const models = useServerDataStore((s) => s.models);
  const workspaces = useServerDataStore((s) => s.workspaces);
  /** Agent learning runs record against the agent's home workspace; the history dialog reads from there. */
  const homeWorkspaceId = editingPreconfig
    ? workspaces.find(w => w.settings?.isAgentHome === true && w.settings?.agentId === editingPreconfig.id)?.id
    : undefined;

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
  }, [editingPreconfig?.id, isMaterialized, sdkClient, homeReload]);

  const handleCreate = () => {
    setDraft({ id: null, form: emptyForm, initial: emptyForm });
  };

  const handleEdit = (preconfig: Preconfig) => {
    const learning = parseAgentLearningSettings(preconfig.settings);
    const next: PreconfigForm = {
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
    };
    setDraft({ id: preconfig.id, form: next, initial: next });
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
          cadence = {
            idleMinutes: idle ? Number(idle) : LEARNING_DEFAULTS.idleMinutes,
            minimumIntervalMinutes: minInterval ? Number(minInterval) : LEARNING_DEFAULTS.minimumIntervalMinutes,
            maximumPendingMinutes: maxPending ? Number(maxPending) : LEARNING_DEFAULTS.maximumPendingMinutes,
          };
          if (![idle, minInterval, maxPending].every(value => !value || /^\d+$/.test(value))
            || !Object.values(cadence).every(value => Number.isInteger(value) && value >= 1 && value <= 10080)
            || cadence.maximumPendingMinutes < cadence.minimumIntervalMinutes) {
            setError('Learning timing must be whole minutes from 1 to 10080, with max pending age at least the minimum interval. Empty fields use defaults.');
            setSaving(false);
            return;
          }
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
        skills: null,
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
      setDraft(null);
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
        skills: null,
        capabilities: preconfig.capabilities ?? null,
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
    if (isDirty) setDiscardOpen(true);
    else setDraft(null);
  };

  if (isCreating || editingPreconfig) {
    return (
      <div className="p-3 sm:p-4 space-y-4">
        <SettingsEditorHeader title={isCreating ? 'New agent' : 'Edit agent'} onBack={handleCancel}
          backLabel="Back to agents" onSave={handleSave} saving={saving} canSave={!!form.name.trim()} />

        {error && <SettingsError>{error}</SettingsError>}

        <div key={isCreating ? 'new' : (editingPreconfig?.id ?? 'edit')} className="space-y-3">
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
            <Select value={form.mode} onValueChange={(mode) => setForm({ ...form, mode: mode as PreconfigForm['mode'] })}>
              <SelectTrigger className="w-full" aria-label="Mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label className="text-sm">Default agent</Label>
              <p className="text-xs text-muted-foreground">New sessions start with this agent; only one can be the default</p>
            </div>
            <Switch
              checked={form.isDefault}
              onCheckedChange={(checked) => setForm({ ...form, isDefault: checked })}
            />
          </div>

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
            {!externalHarness && (
              <p className="text-xs text-muted-foreground">
                Provider is set automatically based on the selected model
              </p>
            )}
          </div>

          <DisclosureRow label="System Prompt" summary={form.systemPrompt.trim() ? 'Custom' : 'None'} defaultOpen={false}>
            <textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              className="w-full h-48 p-3 rounded-lg border bg-background text-sm resize-y"
              placeholder="System prompt content..."
            />
          </DisclosureRow>

          {form.mode !== 'subagent' && (
            <DisclosureRow
              label="Memory & Learning"
              summary={
                [
                  form.capabilityMemory && 'memory',
                  form.capabilitySkills && 'skills',
                  form.learningEnabled && 'learning',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'All off'
              }
              defaultOpen={false}
            >
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Personal memory, skills, and learning across workspaces.</p>
                <MemorySkillsControls scope="agent"
                  memoryEnabled={form.capabilityMemory} skillsEnabled={form.capabilitySkills}
                  onChangeMemory={capabilityMemory => setForm({ ...form, capabilityMemory })}
                  onChangeSkills={capabilitySkills => setForm({ ...form, capabilitySkills })} />

                <Separator className="my-1" />

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="agent-learning-enabled" className="text-sm">Automatic learning</Label>
                      <p className="text-xs text-muted-foreground">
                        Reviews this agent's sessions when idle and saves durable lessons to its personal memory.
                      </p>
                    </div>
                    <Switch
                      id="agent-learning-enabled"
                      checked={form.learningEnabled}
                      onCheckedChange={(checked) => setForm({ ...form, learningEnabled: checked })}
                    />
                  </div>
                  {homeWorkspaceId && (
                    <button
                      type="button"
                      className="w-fit text-xs text-primary underline-offset-4 hover:underline"
                      aria-label="Learning history"
                      onClick={() => setHistoryOpen(true)}
                    >
                      History
                    </button>
                  )}
                  {form.learningEnabled && (
                    <div className="space-y-2">
                      {externalHarness && (
                        <p className="text-xs text-muted-foreground">
                          Reviews run on {externalHarness} (from the agent's model pin) with that harness's own
                          tools; harness reviews can't be undone from history.
                        </p>
                      )}
                      <DisclosureRow label="Timing" defaultOpen={false}
                        summary={LEARNING_FIELDS.some(field => form[field.key].trim()) ? 'Customized' : 'Defaults'}>
                        <p className="text-xs text-muted-foreground">Minutes. Leave empty for defaults.</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {LEARNING_FIELDS.map(field => (
                            <div key={field.key} className="space-y-1">
                              <Label htmlFor={field.key} className="text-xs font-normal text-muted-foreground">{field.label}</Label>
                              <Input
                                id={field.key}
                                type="number"
                                min={1}
                                max={10080}
                                value={form[field.key]}
                                onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                                placeholder={String(field.defaultValue)}
                                className="h-8 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      </DisclosureRow>
                      <DisclosureRow label="Learning focus" summary={form.learningInstructions.trim() || null} defaultOpen={false}>
                        <Textarea
                          aria-label="Learning focus"
                          value={form.learningInstructions}
                          onChange={(e) => setForm({ ...form, learningInstructions: e.target.value })}
                          placeholder="What this agent should focus on when learning..."
                        />
                      </DisclosureRow>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Which workspaces feed this agent's learning</p>
                        <Select
                          value={form.learningSourcesMode}
                          onValueChange={(mode) => setForm({ ...form, learningSourcesMode: mode as PreconfigForm['learningSourcesMode'] })}
                        >
                          <SelectTrigger className="w-full" aria-label="Learning sources">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="all">All workspaces</SelectItem>
                              <SelectItem value="selected">Selected workspaces</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
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
              </div>
            </DisclosureRow>
          )}

          {editingPreconfig && isMaterialized && (
            <DisclosureRow label="Personal files" summary={`${homeSkills.length} skill${homeSkills.length === 1 ? '' : 's'}`} defaultOpen={false}>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Memory and skills stored in this agent's home directory.</p>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setHomeReload(n => n + 1)}
                    title="Reload home data"
                    aria-label="Reload home data"
                  >
                    <RefreshCw className="size-3" />
                  </Button>
                </div>
                {homeError && <SettingsError>{homeError}</SettingsError>}
                {homeLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">User preferences (USER.md)</p>
                      <textarea
                        value={homeDraft.user}
                        onChange={(e) => setHomeDraft({ ...homeDraft, user: e.target.value })}
                        className="w-full h-20 p-2 rounded-md border bg-background text-xs font-mono resize-y"
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Memory (MEMORY.md)</p>
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
                      <p className="text-xs text-muted-foreground">
                        Personal skills ({homeSkills.length}). Read-only; the agent manages them at runtime.
                      </p>
                      {homeSkills.length > 0 && (
                        <div className="rounded-md border divide-y">
                          {homeSkills.map((skill) => (
                            <div key={skill.name} className="px-2.5 py-1.5">
                              <p className="font-mono text-xs truncate">{skill.name}</p>
                              {skill.description && (
                                <p className="text-xs text-muted-foreground line-clamp-1">{skill.description}</p>
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
                        Remove personal files
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </DisclosureRow>
          )}

          <DisclosureRow
            label="Prokop Runtime"
            summary={externalHarness ? `Not used by ${externalHarness}` : [
              `${form.tools.length} tool${form.tools.length === 1 ? '' : 's'}`,
              form.canSpawnSubagentsMode === 'all' ? 'subagents: all'
                : form.canSpawnSubagentsMode === 'specific'
                  ? `${form.canSpawnSubagentsList.length} subagent${form.canSpawnSubagentsList.length === 1 ? '' : 's'}` : null,
              form.temperature.trim() ? `temp ${form.temperature.trim()}` : null,
            ].filter(Boolean).join(' · ')}
            defaultOpen={false}
          >
            <div className="space-y-4">
              <p className={cn('text-xs text-muted-foreground', externalHarness && 'rounded-md bg-muted/50 px-2.5 py-2 text-foreground')}>
                {externalHarness
                  ? `This agent runs on ${externalHarness}, which uses its own tools, subagents, and sampling. These settings apply only if you switch it to a Prokop model.`
                  : 'Applies only when this agent runs on the Prokop harness. Codex and Claude sessions use their own tools, agents, and sampling settings.'}
              </p>

              <div className={cn('space-y-4', externalHarness && 'opacity-60')}>
              <div className="space-y-2">
                <Label className="text-sm">Tools</Label>
                <p className="text-xs text-muted-foreground">
                  Only the selected tools are available. With none selected, this agent has no tools from this list.
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
                            <span className="text-xs text-muted-foreground truncate">{tool.description}</span>
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
            </div>

              <div className="space-y-3 border-t pt-3">
                <Label className="text-sm">Subagents</Label>
              <div className="space-y-2">
                <Select
                  value={form.canSpawnSubagentsMode}
                  onValueChange={(mode) => setForm({ ...form, canSpawnSubagentsMode: mode as PreconfigForm['canSpawnSubagentsMode'] })}
                >
                  <SelectTrigger className="w-full" aria-label="Subagents">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">None: cannot spawn subagents</SelectItem>
                      <SelectItem value="all">All available subagents</SelectItem>
                      <SelectItem value="specific">Specific subagents</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>

                {form.canSpawnSubagentsMode === 'specific' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Select which subagents this agent can spawn
                    </p>

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

                    {availableSubagents.length === 0 && (
                      <p className="text-xs text-muted-foreground">No subagent-mode agents available yet.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="allow-self-as-subagent" className="text-sm">Allow Self as Subagent</Label>
                  <p className="text-xs text-muted-foreground">
                    Allows this agent to delegate once to a new copy of itself. The copy cannot delegate to itself again.
                  </p>
                  {form.canSpawnSubagentsMode === 'none' && (
                    <p className="text-xs text-muted-foreground">Enable subagent spawning first.</p>
                  )}
                  {form.mode === 'primary' && (
                    <p className="text-xs text-muted-foreground">This setting has no effect while the mode is Primary.</p>
                  )}
                </div>
                <Switch
                  id="allow-self-as-subagent"
                  checked={form.allowSelfAsSubagent}
                  disabled={form.canSpawnSubagentsMode === 'none'}
                  onCheckedChange={(checked) => setForm({ ...form, allowSelfAsSubagent: checked })}
                />
              </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm">Temperature</Label>
                <p className="text-xs text-muted-foreground">
                  Sampling temperature (0.1–0.9); leave empty for the server default. Not applied to GPT models on the Codex provider.
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
              </div>
            </div>
          </DisclosureRow>
        </div>

        {homeWorkspaceId && (
          <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
            <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
              <DialogHeader className="shrink-0">
                <DialogTitle>History</DialogTitle>
                <DialogDescription>Learning runs and revision-checked undo.</DialogDescription>
              </DialogHeader>
              <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <LearningHistory workspaceId={homeWorkspaceId} />
              </div>
            </DialogContent>
          </Dialog>
        )}

        <ConfirmDialog
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard changes?"
          description="Your edits to this agent have not been saved."
          confirmLabel="Discard"
          variant="destructive"
          onConfirm={() => {
            setDiscardOpen(false);
            setDraft(null);
          }}
        />
      </div>
    );
  }

  if (loading) return <SettingsLoading />;

  /** The model an agent is pinned to, as people scan for it in the list. */
  const modelLabel = (preconfig: Preconfig): string => {
    if (!preconfig.model) return 'Server default';
    if (preconfig.modelHarness === 'codex-cli' || preconfig.modelHarness === 'claude-cli') {
      const catalog = preconfig.modelHarness === 'codex-cli' ? codexCatalogModels : claudeCatalogModels;
      const name = catalog.find(m => m.model === preconfig.model)?.name ?? preconfig.model;
      return `${preconfig.modelHarness === 'codex-cli' ? 'Codex' : 'Claude'} · ${name}`;
    }
    return models.find(m => m.id === preconfig.model)?.name ?? preconfig.model;
  };

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {preconfigs.length} agent{preconfigs.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-3" data-icon="inline-start" />
          New Agent
        </Button>
      </div>

      {error && <SettingsError>{error}</SettingsError>}

      {preconfigs.length === 0 ? (
        <SettingsEmpty>No agents yet. Create one to get started.</SettingsEmpty>
      ) : (
        <div className="space-y-1.5">
          {preconfigs.map((preconfig) => (
            <SettingsListRow
              key={preconfig.id}
              title={preconfig.name}
              description={preconfig.description}
              meta={modelLabel(preconfig)}
              onOpen={() => handleEdit(preconfig)}
              badges={<>
                {preconfig.isDefault && (
                  <Badge variant="outline" className="h-4 shrink-0 gap-0.5 px-1.5 py-0 text-[10px]">
                    <Star className="size-2.5" />
                    Default
                  </Badge>
                )}
                {preconfig.mode && preconfig.mode !== 'primary' && (
                  <Badge variant="secondary" className="h-4 shrink-0 px-1.5 py-0 text-[10px]">
                    {preconfig.mode === 'subagent' ? 'Subagent' : 'Primary + subagent'}
                  </Badge>
                )}
              </>}
              actions={<>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => handleDuplicate(preconfig)}
                  disabled={duplicatingId !== null}
                  aria-label={`Duplicate agent ${preconfig.name}`}
                  title="Duplicate agent"
                >
                  {duplicatingId === preconfig.id
                    ? <Loader2 className="size-3 animate-spin" />
                    : <Copy className="size-3" />}
                </Button>
                {preconfig.isDefault ? <span className="size-6" aria-hidden /> : (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => setDeleteTarget(preconfig.id)}
                    aria-label={`Delete agent ${preconfig.name}`}
                    title="Delete agent"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </>}
            />
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
        title="Remove personal files"
        description="This removes the agent directory and its home workspace. Sessions created in the home workspace will be deleted. The agent definition is preserved."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleDemote}
        loading={demoting}
      />
    </div>
  );
}
