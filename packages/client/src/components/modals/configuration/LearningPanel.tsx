import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, History, Plus, X } from 'lucide-react';
import type { LearningCadence, LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { LearningHistory } from './LearningHistory';
import { LearningModelPicker } from './LearningModelPicker';
import { LearningSourcePicker } from './LearningSourcePicker';
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

/** Server defaults for a null cadence, scoped like the learning runtime scopes them. */
function defaultCadence(personal: boolean): LearningCadence {
  return personal
    ? { idleMinutes: 60, minimumIntervalMinutes: 1440, maximumPendingMinutes: 1440 }
    : { idleMinutes: 30, minimumIntervalMinutes: 120, maximumPendingMinutes: 1440 };
}

const CADENCE_FIELDS = [
  { key: 'idleMinutes', label: 'Quiet period', hint: 'Idle minutes before a review starts' },
  { key: 'minimumIntervalMinutes', label: 'Min interval', hint: 'Minutes between reviews' },
  { key: 'maximumPendingMinutes', label: 'Max pending age', hint: 'Unreviewed work is picked up after' },
] as const;

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
  const createReviewer = (): LearningReviewer => ({ id: crypto.randomUUID(), preconfigId: initialId!, instructions: '', modelOverride: null, cadence: null });
  const update = (id: string, change: Partial<LearningReviewer>) =>
    onChange({ ...settings, reviewers: settings.reviewers.map(item => item.id === id ? { ...item, ...change } : item) });
  const updateCadence = (item: LearningReviewer, key: keyof LearningCadence, raw: string) => {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0 && number <= 10080) {
      update(item.id, { cadence: { ...defaults, ...item.cadence, [key]: number } });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="learning-enabled">Automatic learning</Label>
          <p className="text-xs text-muted-foreground">
            {personal
              ? 'Review this agent\'s conversations across eligible projects and save durable improvements.'
              : 'Review conversations during quiet periods and maintain shared project knowledge.'}{' '}
            Enabling also turns on Memory and Session search. The first review covers the last seven days.
          </p>
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
          <AlertTitle>Select a default preconfig first</AlertTitle>
          <AlertDescription>Learning needs a preconfig to run reviewers. Pick one in the Preconfigs section.</AlertDescription>
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

          <div className="space-y-3">
            <div className="space-y-0.5">
              <Label>Reviewers</Label>
              <p className="text-xs text-muted-foreground">
                Each reviewer studies eligible conversations and writes knowledge updates.
              </p>
            </div>

            {settings.reviewers.map((item, index) => {
              const cadence = { ...defaults, ...item.cadence };
              const preconfig = preconfigs.find(p => p.id === item.preconfigId);
              return (
                <div key={item.id} className="space-y-4 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      Reviewer {index + 1}{preconfig ? ` · ${preconfig.name}` : ''}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={preview.isPending} onClick={() => preview.mutate(item.id)}>
                        <Eye className="size-4" /> Preview prompt
                      </Button>
                      {!personal && settings.reviewers.length > 1 && (
                        <Button variant="ghost" size="icon-sm" aria-label="Remove reviewer"
                          onClick={() => onChange({ ...settings, reviewers: settings.reviewers.filter(other => other.id !== item.id) })}>
                          <X className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`reviewer-preconfig-${item.id}`}>Preconfig</Label>
                    <Select value={item.preconfigId} disabled={personal} onValueChange={preconfigId => update(item.id, { preconfigId })}>
                      <SelectTrigger id={`reviewer-preconfig-${item.id}`} aria-label="Reviewer preconfig" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {preconfigs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {personal && <p className="text-xs text-muted-foreground">Agent-home reviewers always use this agent's preconfig.</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Model</Label>
                    <LearningModelPicker models={models} preconfig={preconfig} value={item.modelOverride}
                      onChange={modelOverride => update(item.id, { modelOverride })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`focus-${item.id}`}>Review focus</Label>
                    <Textarea id={`focus-${item.id}`} value={item.instructions} maxLength={20_000}
                      placeholder="Optional focus for this reviewer, e.g. 'prefer updating existing notes over creating new ones'"
                      onChange={event => update(item.id, { instructions: event.target.value })} />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Timing (minutes)</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {CADENCE_FIELDS.map(field => (
                        <div key={field.key} className="space-y-1">
                          <Input type="number" min={1} max={10080} aria-label={`${field.label} (minutes)`}
                            value={cadence[field.key]}
                            onChange={event => updateCadence(item, field.key, event.target.value)} />
                          <p className="text-[10px] leading-tight text-muted-foreground">{field.label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Quiet period is how idle the workspace must be; min interval spaces reviews apart; max pending age forces a review of older unreviewed work.
                    </p>
                  </div>
                </div>
              );
            })}

            {!personal && (
              <Button variant="outline" size="sm" disabled={!initialId || settings.reviewers.length >= 20}
                onClick={() => onChange({ ...settings, reviewers: [...settings.reviewers, createReviewer()] })}>
                <Plus className="size-4" /> Add reviewer
              </Button>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="learning-skills">Improve skills</Label>
              <p className="text-xs text-muted-foreground">
                Reviewers may also create and refine workspace skills.
              </p>
            </div>
            <Switch id="learning-skills" checked={settings.improveSkills}
              onCheckedChange={improveSkills => onChange({ ...settings, improveSkills })} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="learning-instructions">Additional review instructions</Label>
            <p className="text-xs text-muted-foreground">Appended to every reviewer's prompt.</p>
            <Textarea id="learning-instructions" value={settings.instructions} maxLength={20_000}
              placeholder="Optional guidance applied to all reviewers"
              onChange={event => onChange({ ...settings, instructions: event.target.value })} />
          </div>

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

      <div>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History className="size-4" /> Review history
        </Button>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>Learning history</DialogTitle>
            <DialogDescription>Workspace reviews and revision-checked undo.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <LearningHistory workspaceId={workspace.id} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewPrompt !== null} onOpenChange={open => { if (!open) setPreviewPrompt(null); }}>
        <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle>Review prompt preview</DialogTitle>
            <DialogDescription>The exact instructions this reviewer will receive.</DialogDescription>
          </DialogHeader>
          <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <pre className="whitespace-pre-wrap break-words text-xs">{previewPrompt}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
