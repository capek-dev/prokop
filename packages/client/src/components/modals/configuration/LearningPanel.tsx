import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Plus, X } from 'lucide-react';
import type { LearningCadence, LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { LearningHistory } from './LearningHistory';
import { LearningModelPicker } from './LearningModelPicker';
import { LearningSourcePicker } from './LearningSourcePicker';
import { useServerDataStore } from '@/stores/serverDataStore';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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

/** Server defaults for a null cadence, scoped like the learning runtime scopes them. */
function defaultCadence(personal: boolean): LearningCadence {
  return personal
    ? { idleMinutes: 60, minimumIntervalMinutes: 1440, maximumPendingMinutes: 1440 }
    : { idleMinutes: 30, minimumIntervalMinutes: 120, maximumPendingMinutes: 1440 };
}

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

interface TuningCollapsibleProps {
  label: string;
  /** Recap of the custom value, shown on the trigger; default sections stay collapsed without one. */
  summary: string | null;
  /** Bounded rows sit inside the learner card, flat rows stand alone in agent-home settings. */
  bordered: boolean;
  children: ReactNode;
}

function TuningCollapsible({ label, summary, bordered, children }: TuningCollapsibleProps) {
  return (
    <Collapsible defaultOpen={summary !== null}>
      <CollapsibleTrigger
        className={cn(
          'group flex w-full items-center gap-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
          bordered ? 'border-t px-3' : 'rounded-md px-2',
        )}
      >
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <span className="shrink-0">{label}</span>
        {summary && <span className="ml-auto truncate text-xs" title={summary}>{summary}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className={bordered ? 'px-3 py-3' : 'py-1'}>{children}</CollapsibleContent>
    </Collapsible>
  );
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
  const workspaces = useServerDataStore(state => state.workspaces);
  const personal = workspace.settings.isAgentHome === true;
  const initialId = personal ? workspace.settings.agentId : getWorkspaceDefaultPreconfigId(workspace, preconfigs);
  const defaults = defaultCadence(personal);
  const settings: WorkspaceLearningSettings = value ?? {
    enabled: false,
    reviewers: [],
    improveSkills: workspace.settings.skills?.managementEnabled === true,
    instructions: '',
    sources: { mode: 'all' },
  };
  const singleReviewer = personal ? settings.reviewers[0] : undefined;
  const createReviewer = (): LearningReviewer => ({ id: crypto.randomUUID(), preconfigId: initialId!, instructions: '', modelOverride: null, cadence: null });
  const update = (id: string, change: Partial<LearningReviewer>) =>
    onChange({ ...settings, reviewers: settings.reviewers.map(item => item.id === id ? { ...item, ...change } : item) });
  const updateCadence = (item: LearningReviewer, key: keyof LearningCadence, raw: string) => {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0 && number <= 10080) {
      update(item.id, { cadence: { ...defaults, ...item.cadence, [key]: number } });
    }
  };
  const learnerModel = (item: LearningReviewer) => (
    <div className="space-y-1.5">
      <Label>Model</Label>
      <LearningModelPicker models={models} preconfig={preconfigs.find(p => p.id === item.preconfigId)} value={item.modelOverride}
        onChange={modelOverride => update(item.id, { modelOverride })} />
    </div>
  );

  /** Focus and timing are rare tuning: collapsed by default, with the custom value recapped on the trigger. */
  const learnerTuning = (item: LearningReviewer, bordered: boolean) => {
    const cadence = { ...defaults, ...item.cadence };
    const timingSummary = item.cadence
      ? CADENCE_FIELDS.map(field => formatMinutes(cadence[field.key])).join(' · ')
      : null;
    return (
      <>
        <TuningCollapsible label="Learning focus" summary={item.instructions.trim() || null} bordered={bordered}>
          <Textarea aria-label="Learning focus" value={item.instructions} maxLength={20_000}
            placeholder="Optional focus, e.g. 'prefer updating existing notes over creating new ones'"
            onChange={event => update(item.id, { instructions: event.target.value })} />
        </TuningCollapsible>

        <TuningCollapsible label="Timing" summary={timingSummary} bordered={bordered}>
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
        </TuningCollapsible>
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
            {personal
              ? "Study this agent's conversations across eligible projects and save durable improvements."
              : 'Study conversations during quiet periods and maintain shared project knowledge.'}{' '}
            Enabling also turns on Memory and Session search. The first run covers the last seven days.
          </p>
          <button
            type="button"
            className="w-fit text-xs text-primary underline-offset-4 hover:underline"
            onClick={() => setHistoryOpen(true)}
          >
            Learning history
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
          <AlertTitle>{personal ? 'Agent reference missing' : 'Select a default preconfig first'}</AlertTitle>
          <AlertDescription>
            {personal
              ? 'This agent home has no agent reference, so learning cannot run.'
              : 'Learning needs a preconfig to run. Pick one in the Preconfigs section.'}
          </AlertDescription>
        </Alert>
      )}

      {!personal && (
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="personal-learning">Use as personal learning source</Label>
            <p className="text-xs text-muted-foreground">
              Allow agent-home workspaces to include this workspace's conversations when their agents learn.
            </p>
          </div>
          <Switch id="personal-learning" checked={allowPersonalLearning} onCheckedChange={onPersonalLearningChange} />
        </div>
      )}

      {settings.enabled && (
        <>
          <Separator />

          {personal ? (
            singleReviewer && (
              <div className="space-y-3">
                {learnerModel(singleReviewer)}
                {learnerTuning(singleReviewer, false)}
                {previewLink(singleReviewer, false)}
              </div>
            )
          ) : (
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
                        <Label htmlFor={`reviewer-preconfig-${item.id}`}>Preconfig</Label>
                        <Select value={item.preconfigId} onValueChange={preconfigId => update(item.id, { preconfigId })}>
                          <SelectTrigger id={`reviewer-preconfig-${item.id}`} aria-label="Learner preconfig" className="w-full">
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
                {personal ? "Learning may also create and refine this agent's skills." : 'Learning may also create and refine workspace skills.'}{' '}
                Turning this on also enables skill management.
              </p>
            </div>
            <Switch id="learning-skills" checked={settings.improveSkills}
              onCheckedChange={improveSkills => onChange({ ...settings, improveSkills })} />
          </div>

          {!personal && (
            <TuningCollapsible label="Shared instructions" summary={settings.instructions.trim() || null} bordered={false}>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Appended to every learner's prompt.</p>
                <Textarea aria-label="Shared instructions" value={settings.instructions} maxLength={20_000}
                  placeholder="Optional guidance applied to all learners"
                  onChange={event => onChange({ ...settings, instructions: event.target.value })} />
              </div>
            </TuningCollapsible>
          )}

          {personal && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <Label>Learning sources</Label>
                <p className="text-xs text-muted-foreground">Which workspaces this agent learns from.</p>
                <Select value={settings.sources.mode}
                  onValueChange={mode => onChange({ ...settings, sources: mode === 'all' ? { mode: 'all' } : { mode: 'selected', workspaceIds: [] } })}>
                  <SelectTrigger aria-label="Learning sources" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All eligible workspaces</SelectItem>
                      <SelectItem value="selected">Selected workspaces</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {settings.sources.mode === 'selected' && (
                  <LearningSourcePicker workspaces={workspaces} selectedIds={settings.sources.workspaceIds}
                    onChange={workspaceIds => onChange({ ...settings, sources: { mode: 'selected', workspaceIds } })} />
                )}
              </div>
            </>
          )}
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
            <DialogTitle>Learning history</DialogTitle>
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
