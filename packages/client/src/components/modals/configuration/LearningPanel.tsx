import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { LearningCadence, LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { LearningHistory } from './LearningHistory';
import { AgentModelPicker, type AgentModelSelection } from './AgentModelPicker';
import { DisclosureRow } from './DisclosureRow';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';

export interface LearningPanelProps {
  workspace: Workspace;
  preconfigs: Preconfig[];
  value: WorkspaceLearningSettings | undefined;
  allowPersonalLearning: boolean;
  onChange(value: WorkspaceLearningSettings): void;
  onPersonalLearningChange(value: boolean): void;
}

/** Server defaults for a null cadence. */
const DEFAULT_CADENCE: LearningCadence = { idleMinutes: 30, minimumIntervalMinutes: 120, maximumPendingMinutes: 1440 };

const CADENCE_FIELDS = [
  { key: 'idleMinutes', label: 'Quiet period' },
  { key: 'minimumIntervalMinutes', label: 'Min interval' },
  { key: 'maximumPendingMinutes', label: 'Max pending age' },
] as const;

function formatMinutes(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function LearningPanel({ workspace, preconfigs, value, allowPersonalLearning, onChange: onSettingsChange, onPersonalLearningChange }: LearningPanelProps) {
  const client = useSdkClient();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: async (reviewerId: string) => {
      if (!client || !value?.enabled) throw new Error('Enable learning first');
      const result = await client.http.workspaces.previewLearning(workspace.id, value, reviewerId);
      return result.prompt;
    },
    onSuccess: prompt => setPreviewPrompt(prompt),
  });
  const onChange = (settings: WorkspaceLearningSettings) => { preview.reset(); setPreviewPrompt(null); onSettingsChange(settings); };
  const models = useServerDataStore(state => state.models);
  const initialId = getWorkspaceDefaultPreconfigId(workspace, preconfigs);

  /** A harness-pinned learner agent runs its reviews as headless turns on that
   * harness unless overridden; overrides may target any harness's models. */
  const pinnedHarness = (preconfig: Preconfig | undefined): 'codex-cli' | 'claude-cli' | null =>
    preconfig?.modelHarness === 'codex-cli' || preconfig?.modelHarness === 'claude-cli'
      ? preconfig.modelHarness
      : null;
  // Any learner can override its model to any harness, so the CLI catalogs
  // are fetched whenever reviewers exist.
  const hasReviewers = (value?.reviewers?.length ?? 0) > 0;
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog'],
    queryFn: () => client!.http.sessions.claudeCatalog(),
    enabled: !!client && hasReviewers,
    staleTime: 60_000,
    retry: false,
  });
  const codexCatalog = useQuery({
    queryKey: ['codex-catalog'],
    queryFn: () => client!.http.sessions.codexCatalog(),
    enabled: !!client && hasReviewers,
    staleTime: 60_000,
    retry: false,
  });
  const defaults = DEFAULT_CADENCE;
  const settings: WorkspaceLearningSettings = value ?? {
    enabled: false,
    reviewers: [],
    improveSkills: workspace.settings.skills?.managementEnabled === true,
    instructions: '',
    sources: { mode: 'all' },
  };
  const createReviewer = (): LearningReviewer => ({ id: crypto.randomUUID(), preconfigId: initialId!, instructions: '', modelOverride: null, cadence: null });
  const update = (id: string, change: Partial<LearningReviewer>) =>
    onChange({ ...settings, reviewers: settings.reviewers.map(item => item.id === id ? { ...item, ...change } : item) });
  const updateCadence = (item: LearningReviewer, key: keyof LearningCadence, raw: string) => {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0 && number <= 10080) {
      update(item.id, { cadence: { ...defaults, ...item.cadence, [key]: number } });
    }
  };
  const learnerModel = (item: LearningReviewer) => {
    const preconfig = preconfigs.find(p => p.id === item.preconfigId);
    const pin = pinnedHarness(preconfig);
    const override = item.modelOverride;
    const effective: 'prokop' | 'codex-cli' | 'claude-cli'
      = override ? (override.harness ?? 'prokop') : (pin ?? 'prokop');
    const selection: AgentModelSelection = override
      ? {
          model: override.modelId,
          provider: override.harness ? '' : override.providerId,
          variant: override.variant ?? '',
          modelHarness: (override.harness ?? 'prokop') as AgentModelSelection['modelHarness'],
        }
      : { model: '', provider: '', variant: '', modelHarness: '' };
    const catalogModels = pin === 'codex-cli' ? codexCatalog.data?.models : claudeCatalog.data?.models;
    const agentDefault = pin
      ? `${pin === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'} · ${catalogModels?.find(m => m.model === preconfig?.model)?.name ?? preconfig?.model ?? 'agent-pinned model'}`
      : models.find(m => m.id === preconfig?.model && m.providerId === preconfig?.provider)?.name
        ?? preconfig?.model ?? null;
    return (
      <div className="space-y-1.5">
        <Label>Model</Label>
        <AgentModelPicker
          models={models}
          codexModels={codexCatalog.data?.models ?? []}
          claudeModels={claudeCatalog.data?.models ?? []}
          value={selection}
          onChange={next => update(item.id, {
            modelOverride: next.modelHarness === '' ? null : {
              providerId: next.modelHarness === 'prokop' ? next.provider : '',
              modelId: next.model,
              variant: next.variant || null,
              ...(next.modelHarness !== 'prokop' ? { harness: next.modelHarness } : {}),
            },
          })}
          defaultLabel="Use agent default"
        />
        {!override && agentDefault && (
          <p className="text-xs text-muted-foreground">Agent default: {agentDefault}</p>
        )}
        {effective !== 'prokop' && (
          <p className="text-xs text-muted-foreground">
            Reviews run on {effective === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'} with this model.
            Harness reviews can't be undone from history.
          </p>
        )}
      </div>
    );
  };

  /** Focus and timing are rare tuning: collapsed by default, with the custom value recapped on the trigger. */
  const learnerTuning = (item: LearningReviewer, bordered: boolean) => {
    const cadence = { ...defaults, ...item.cadence };
    const timingSummary = item.cadence
      ? CADENCE_FIELDS.map(field => formatMinutes(cadence[field.key])).join(' · ')
      : null;
    return (
      <>
        <DisclosureRow label="Learning focus" summary={item.instructions.trim() || null} bordered={bordered}>
          <Textarea aria-label="Learning focus" value={item.instructions} maxLength={20_000}
            placeholder="Optional focus, e.g. 'prefer updating existing notes over creating new ones'"
            onChange={event => update(item.id, { instructions: event.target.value })} />
        </DisclosureRow>

        <DisclosureRow label="Timing" summary={timingSummary} bordered={bordered}>
          <div className="space-y-1.5">
            <div className="grid grid-cols-3 gap-2">
              {CADENCE_FIELDS.map(field => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={`cadence-${field.key}-${item.id}`} className="text-xs font-normal text-muted-foreground">{field.label}</Label>
                  <Input id={`cadence-${field.key}-${item.id}`} type="number" min={1} max={10080}
                    value={cadence[field.key]}
                    onChange={event => updateCadence(item, field.key, event.target.value)} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Minutes. Quiet period is required idle time, min interval spaces runs apart, max pending age forces a run on unreviewed work.
            </p>
          </div>
        </DisclosureRow>
      </>
    );
  };

  /** One preview control for both layouts: a quiet link ending the learner's section. */
  const previewLink = (item: LearningReviewer, bordered: boolean) => {
    const link = (
      <button
        type="button"
        className="text-xs text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
        disabled={preview.isPending}
        onClick={() => preview.mutate(item.id)}
      >
        Preview prompt
      </button>
    );
    return bordered ? <div className="border-t px-3 py-2">{link}</div> : link;
  };

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="learning-enabled">Automatic learning</Label>
          <p className="text-xs text-muted-foreground">
            {'Study conversations during quiet periods and maintain shared project knowledge. '}
            Enabling also turns on Memory. The first run covers the last seven days.
          </p>
          <button
            type="button"
            className="w-fit text-xs text-primary underline-offset-4 hover:underline"
            onClick={() => setHistoryOpen(true)}
          >
            History
          </button>
        </div>
        <Switch
          id="learning-enabled"
          checked={settings.enabled}
          disabled={!initialId}
          onCheckedChange={enabled => onChange({ ...settings, enabled, reviewers: settings.reviewers.length ? settings.reviewers : [createReviewer()] })}
        />
      </div>

      {!initialId && (
        <Alert>
          <AlertTitle>Select a default agent first</AlertTitle>
          <AlertDescription>
            Learning needs an agent to run. Pick one in the Sessions section.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="personal-learning">Use as personal learning source</Label>
          <p className="text-xs text-muted-foreground">
            Allow agent-home workspaces to include this workspace's conversations when their agents learn.
          </p>
        </div>
        <Switch id="personal-learning" checked={allowPersonalLearning} onCheckedChange={onPersonalLearningChange} />
      </div>

      {settings.enabled && (
        <>
          <Separator />

          {(
            <div className="space-y-3">
              <div className="space-y-0.5">
                <Label>Learners</Label>
                <p className="text-xs text-muted-foreground">
                  Each learner studies eligible conversations and writes knowledge updates.
                </p>
              </div>

              {settings.reviewers.map((item, index) => {
                const preconfig = preconfigs.find(p => p.id === item.preconfigId);
                return (
                  <div key={item.id} className="rounded-md border">
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <span className="truncate text-sm font-medium">
                        Learner {index + 1}{preconfig ? ` · ${preconfig.name}` : ''}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {settings.reviewers.length > 1 && (
                          <Button variant="ghost" size="icon-sm" aria-label="Remove learner"
                            onClick={() => onChange({ ...settings, reviewers: settings.reviewers.filter(other => other.id !== item.id) })}>
                            <X className="size-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 border-t px-3 py-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`reviewer-preconfig-${item.id}`}>Agent</Label>
                        <Select value={item.preconfigId} onValueChange={preconfigId => update(item.id, { preconfigId })}>
                          <SelectTrigger id={`reviewer-preconfig-${item.id}`} aria-label="Learner agent" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {preconfigs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {learnerModel(item)}
                    </div>

                    {learnerTuning(item, true)}
                    {previewLink(item, true)}
                  </div>
                );
              })}

              <Button variant="outline" size="sm" disabled={!initialId || settings.reviewers.length >= 20}
                onClick={() => onChange({ ...settings, reviewers: [...settings.reviewers, createReviewer()] })}>
                <Plus className="size-4" /> Add learner
              </Button>
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="learning-skills">Improve skills</Label>
              <p className="text-xs text-muted-foreground">
                {'Learning may also create and refine workspace skills. '}
                Turning this on also enables skill management.
              </p>
            </div>
            <Switch id="learning-skills" checked={settings.improveSkills}
              onCheckedChange={improveSkills => onChange({ ...settings, improveSkills })} />
          </div>

          <DisclosureRow label="Shared instructions" summary={settings.instructions.trim() || null} bordered={false}>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Appended to every learner's prompt.</p>
              <Textarea aria-label="Shared instructions" value={settings.instructions} maxLength={20_000}
                placeholder="Optional guidance applied to all learners"
                onChange={event => onChange({ ...settings, instructions: event.target.value })} />
            </div>
          </DisclosureRow>

        </>
      )}

      {preview.error && (
        <Alert variant="destructive">
          <AlertTitle>Preview failed</AlertTitle>
          <AlertDescription>{preview.error.message}</AlertDescription>
        </Alert>
      )}

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>History</DialogTitle>
            <DialogDescription>Learning runs and revision-checked undo.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <LearningHistory workspaceId={workspace.id} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewPrompt !== null} onOpenChange={open => { if (!open) setPreviewPrompt(null); }}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>Prompt preview</DialogTitle>
            <DialogDescription>The exact prompt this learning run uses.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <pre className="whitespace-pre-wrap break-words text-xs">{previewPrompt}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
