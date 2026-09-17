import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ContextSelectionSettings, ContextSelectionUpdate, ProkopaiClient } from '@prokopai/sdk';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUIStore } from '@/stores/uiStore';

import { queryKeys } from '@/lib/queryKeys';

const contextSelectionSettingsKey = queryKeys.config.contextSelection;

function SelectionPolicyFields({ settings, disabled, save }: {
  settings: ContextSelectionSettings;
  disabled: boolean;
  save: (update: ContextSelectionUpdate) => void;
}) {
  const [level, setLevel] = useState(String(settings.minimumLevel));
  const [percent, setPercent] = useState(String(Number((settings.requiredProbability * 100).toFixed(6))));
  const valid = level.trim() !== '' && Number.isInteger(Number(level)) && Number(level) >= 0 && Number(level) <= 3
    && percent.trim() !== '' && Number.isFinite(Number(percent)) && Number(percent) >= 0 && Number(percent) <= 100;
  const changed = Number(level) !== settings.minimumLevel || Number(percent) / 100 !== settings.requiredProbability;
  return <form className="flex flex-col items-start gap-3" onSubmit={event => {
    event.preventDefault();
    if (valid && changed && !disabled) save({ minimumLevel: Number(level), requiredProbability: Number(percent) / 100 });
  }}>
    <Label htmlFor="context-minimum-level">Minimum relevance level</Label>
    <Input id="context-minimum-level" className="max-w-24" type="number" min={0} max={3} step={1} required disabled={disabled}
      value={level} onChange={event => setLevel(event.target.value)} aria-describedby="context-level-help" />
    <p id="context-level-help" className="text-xs text-muted-foreground">0: Unrelated · 1: Related topic · 2: Directly useful · 3: Prevents a concrete mistake</p>
    <Label htmlFor="context-required-probability">Required probability (%)</Label>
    <Input id="context-required-probability" className="max-w-24" type="number" min={0} max={100} step="any" required disabled={disabled}
      value={percent} onChange={event => setPercent(event.target.value)} aria-describedby="context-probability-help" />
    <p id="context-probability-help" className="text-xs text-muted-foreground">Adds the probabilities at or above the minimum level. Qualifying items still need to fit the memory and skill budgets.</p>
    <Button type="submit" variant="ghost" size="sm" disabled={disabled || !valid || !changed}>Save selection settings</Button>
  </form>;
}

export function ExperimentalPanel({ sdkClient }: { sdkClient: ProkopaiClient | null }) {
  const cache = useQueryClient();
  const setSection = useUIStore(state => state.setConfigurationSection);
  const settings = useQuery({
    queryKey: contextSelectionSettingsKey,
    queryFn: ({ signal }) => {
      if (!sdkClient) throw new Error('Server unavailable');
      return sdkClient.http.providers.getContextSelection({ signal });
    },
    enabled: Boolean(sdkClient),
  });
  const update = useMutation({
    mutationFn: (enabled: boolean | ContextSelectionUpdate) => {
      if (!sdkClient) throw new Error('Server unavailable');
      return sdkClient.http.providers.setContextSelection(enabled);
    },
    onSuccess: data => { cache.setQueryData(contextSelectionSettingsKey, data); },
    onError: () => { void cache.invalidateQueries({ queryKey: contextSelectionSettingsKey }); },
  });
  if (!sdkClient) return <p className="p-3 sm:p-4">Connect to a server to change experimental settings.</p>;
  return <div className="flex flex-col gap-4 p-3 sm:p-4">
    <p className="text-sm text-muted-foreground">Experimental features apply to this server. Changes take effect on subsequent responses.</p>
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor="context-selection-enabled">Select relevant memory and skills</Label>
      <Switch id="context-selection-enabled" checked={settings.data?.enabled ?? false}
        disabled={!settings.data || settings.isError || update.isPending || (!settings.data.configured && !settings.data.enabled)}
        onCheckedChange={enabled => update.mutate(enabled)} />
    </div>
    <p className="text-sm text-muted-foreground">Uses TypeSafe Jev to select context. Enabling sends task text, recent conversation, memory entries and allowed skill content to TypeSafe. Preferences and system instructions remain included. Failures use bounded standard memory context.</p>
    <p className="text-sm text-muted-foreground">Enabling raises workspace and agent MEMORY.md capacity to 50,000 characters each. Responses keep a 5,000-character memory budget; USER.md stays at 1,500. Turning this off preserves saved files and restores the 2,500-character write limit.</p>
    {settings.data && settings.data.minimumLevel !== undefined && <SelectionPolicyFields
      key={`${settings.data.minimumLevel}:${settings.data.requiredProbability}`}
      settings={settings.data} disabled={settings.isError || update.isPending} save={value => update.mutate(value)} />}
    {settings.isPending && <p role="status">Loading experimental settings…</p>}
    {settings.data && !settings.data.configured && <div className="flex flex-col items-start gap-2">
      <p className="text-sm">{settings.data.enabled ? 'Selection is paused because TypeSafe has no key. You can turn it off or configure a key.' : 'Configure a TypeSafe API key before enabling selection.'}</p>
      <Button variant="ghost" size="sm" onClick={() => setSection('providers')}>Open LLM Providers</Button>
    </div>}
    {(settings.isError || update.isError) && <Alert variant="destructive"><AlertDescription>
      {update.isError ? 'Could not save the setting. Check the TypeSafe key and try again.' : 'Could not load experimental settings.'}
      <Button variant="ghost" size="sm" onClick={() => { update.reset(); void settings.refetch(); }}>Retry</Button>
    </AlertDescription></Alert>}
  </div>;
}
