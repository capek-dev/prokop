import type { LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { LearningHistory } from './LearningHistory';
import { LearningModelPicker } from './LearningModelPicker';
import { LearningSourcePicker } from './LearningSourcePicker';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';

export interface LearningPanelProps {
  workspace: Workspace;
  preconfigs: Preconfig[];
  value: WorkspaceLearningSettings | undefined;
  allowPersonalLearning: boolean;
  onChange(value: WorkspaceLearningSettings): void;
  onPersonalLearningChange(value: boolean): void;
}

export function LearningPanel({ workspace, preconfigs, value, allowPersonalLearning, onChange: onSettingsChange, onPersonalLearningChange }: LearningPanelProps) {
  const client = useSdkClient();
  const [showHistory, setShowHistory] = useState(false);
  const preview = useMutation({ mutationFn: (reviewerId: string) => {
    if (!client || !value) throw new Error('Enable learning first');
    return client.http.workspaces.previewLearning(workspace.id, value, reviewerId);
  } });
  const onChange = (settings: WorkspaceLearningSettings) => { preview.reset(); onSettingsChange(settings); };
  const models = useServerDataStore(state => state.models);
  const workspaces = useServerDataStore(state => state.workspaces);
  const personal = workspace.settings.isAgentHome === true;
  const initialId = personal ? workspace.settings.agentId : getWorkspaceDefaultPreconfigId(workspace, preconfigs);
  const settings: WorkspaceLearningSettings = value ?? { enabled: false, reviewers: [], improveSkills: workspace.settings.skills?.managementEnabled === true, instructions: '', sources: { mode: 'all' } };
  const reviewer = (): LearningReviewer => ({ id: crypto.randomUUID(), preconfigId: initialId!, instructions: '', modelOverride: null, cadence: null });
  const update = (id: string, change: Partial<LearningReviewer>) => onChange({ ...settings, reviewers: settings.reviewers.map(item => item.id === id ? { ...item, ...change } : item) });
  return <div className="flex flex-col gap-5 p-3 sm:p-4">
    <div className="flex items-center justify-between gap-3">
      <div><Label htmlFor="learning-enabled">Automatic learning</Label><p className="text-xs text-muted-foreground">{personal ? 'Improve this agent across eligible projects.' : 'Maintain shared project knowledge during quiet periods.'} Enabling also enables Memory and Session search. The first review includes seven days of recent work.</p></div>
      <Switch id="learning-enabled" checked={settings.enabled} disabled={!initialId} onCheckedChange={enabled => onChange({ ...settings, enabled, reviewers: settings.reviewers.length ? settings.reviewers : [reviewer()] })} />
    </div>
    {!initialId && <p role="status">Select a default preconfig before enabling learning.</p>}
    {!personal && <div className="flex items-center justify-between gap-3"><Label htmlFor="personal-learning">Allow agents to learn from this workspace across projects</Label><Switch id="personal-learning" checked={allowPersonalLearning} onCheckedChange={onPersonalLearningChange} /></div>}
    {settings.enabled && <>
      {settings.reviewers.map(item => <fieldset key={item.id} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm">Reviewer</legend>
        <Select value={item.preconfigId} disabled={personal} onValueChange={preconfigId => update(item.id, { preconfigId })}><SelectTrigger aria-label="Reviewer preconfig"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{preconfigs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
        <LearningModelPicker models={models} preconfig={preconfigs.find(p => p.id === item.preconfigId)} value={item.modelOverride}
          onChange={modelOverride => update(item.id, { modelOverride })} />
        <Button variant="ghost" size="sm" disabled={preview.isPending} onClick={() => preview.mutate(item.id)}>Preview review instructions</Button>
        <Label htmlFor={`focus-${item.id}`}>Review focus</Label><Textarea id={`focus-${item.id}`} value={item.instructions} maxLength={20_000} placeholder="Optional focus for this reviewer" onChange={event => update(item.id, { instructions: event.target.value })} />
        <details><summary className="cursor-pointer text-sm">Timing</summary><div className="mt-3 flex flex-col gap-2">{(['idleMinutes', 'minimumIntervalMinutes', 'maximumPendingMinutes'] as const).map((key, index) => <Label key={key}>{['Quiet time (minutes)', 'Minimum interval (minutes)', 'Maximum pending age (minutes)'][index]}<Input type="number" min={1} max={10080} value={item.cadence?.[key] ?? (key === 'idleMinutes' ? personal ? 60 : 30 : key === 'minimumIntervalMinutes' ? personal ? 1440 : 120 : 1440)} onChange={event => {
          const number = Number(event.target.value);
          if (Number.isInteger(number) && number > 0 && number <= 10080) update(item.id, { cadence: { idleMinutes: personal ? 60 : 30, minimumIntervalMinutes: personal ? 1440 : 120, maximumPendingMinutes: 1440, ...item.cadence, [key]: number } });
        }} /></Label>)}</div></details>
        {!personal && settings.reviewers.length > 1 && <Button variant="ghost" size="sm" onClick={() => onChange({ ...settings, reviewers: settings.reviewers.filter(other => other.id !== item.id) })}>Remove reviewer</Button>}
      </fieldset>)}
      {!personal && <Button variant="ghost" size="sm" disabled={!initialId || settings.reviewers.length >= 20} onClick={() => onChange({ ...settings, reviewers: [...settings.reviewers, reviewer()] })}>Add reviewer</Button>}
      <div className="flex items-center justify-between"><Label htmlFor="learning-skills">Improve skills</Label><Switch id="learning-skills" checked={settings.improveSkills} onCheckedChange={improveSkills => onChange({ ...settings, improveSkills })} /></div>
      <Label htmlFor="learning-instructions">Additional review instructions</Label><Textarea id="learning-instructions" value={settings.instructions} maxLength={20_000} onChange={event => onChange({ ...settings, instructions: event.target.value })} />
      {personal && <><Label>Learning sources</Label><Select value={settings.sources.mode} onValueChange={mode => onChange({ ...settings, sources: mode === 'all' ? { mode: 'all' } : { mode: 'selected', workspaceIds: [] } })}><SelectTrigger aria-label="Learning sources"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All eligible workspaces</SelectItem><SelectItem value="selected">Selected workspaces</SelectItem></SelectGroup></SelectContent></Select>
        {settings.sources.mode === 'selected' && <LearningSourcePicker workspaces={workspaces} selectedIds={settings.sources.workspaceIds}
          onChange={workspaceIds => onChange({ ...settings, sources: { mode: 'selected', workspaceIds } })} />}</>}
    </>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {preview.data && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{preview.data.prompt}</pre>}
    <Button variant="ghost" size="sm" onClick={() => setShowHistory(open => !open)}>Learning history</Button>
    {showHistory && <LearningHistory workspaceId={workspace.id} />}
  </div>;
}
