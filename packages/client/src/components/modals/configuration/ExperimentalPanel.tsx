import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useUIStore } from '@/stores/uiStore';

import { queryKeys } from '@/lib/queryKeys';

const contextSelectionSettingsKey = queryKeys.config.contextSelection;

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
    mutationFn: (enabled: boolean) => {
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
