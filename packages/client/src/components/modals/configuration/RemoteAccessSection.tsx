import { useCallback, useEffect, useState } from 'react';
import type { ProkopaiClient, RemoteAccessKind, RemoteAccessStatus } from '@prokopai/sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsError } from './SettingsPrimitives';

const KIND_LABELS: Record<RemoteAccessKind, string> = {
  lan: 'Wi-Fi / LAN',
  tailscale: 'Tailscale',
  vpn: 'VPN',
  proxy: 'Proxy',
};

interface RemoteAccessSectionProps {
  sdkClient: ProkopaiClient;
}

/**
 * How other devices reach this server: listen on the network, publish an
 * address (VPN, proxy, tunnel), or share over Tailscale HTTPS.
 */
export function RemoteAccessSection({ sdkClient }: RemoteAccessSectionProps) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await sdkClient.http.remoteAccess.status());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sdkClient]);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    sdkClient.on('access.changed', refresh);
    return () => { sdkClient.off('access.changed', refresh); };
  }, [sdkClient, load]);

  const run = async (action: () => Promise<RemoteAccessStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
      setError(null);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!status) return error ? <SettingsError>{error}</SettingsError> : null;

  const tailscaleShared = status.tailscale.serving
    && status.addresses.some((item) => item.url === status.tailscale.url);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-sm font-medium">Remote access</Label>
        <p className="text-sm text-muted-foreground">Choose how your phone and other devices reach Prokop. They still have to be paired.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm">Allow devices on my network</span>
          <p className="text-xs text-muted-foreground">
            {status.bindLockedByEnvironment
              ? `Set by PROKOPAI_HOST (${status.bindHost}).`
              : 'Wi-Fi, LAN, and VPNs such as Tailscale or WireGuard.'}
          </p>
        </div>
        <Switch
          checked={status.listenOnNetwork}
          disabled={busy || status.bindLockedByEnvironment}
          onCheckedChange={(checked) => void run(() => sdkClient.http.remoteAccess.setListenOnNetwork(checked))}
          aria-label="Allow devices on my network"
        />
      </div>

      {status.tailscale.installed && (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm">Tailscale HTTPS</span>
            <p className="truncate text-xs text-muted-foreground">
              {!status.tailscale.running ? 'Tailscale is not connected on this computer.'
                : tailscaleShared ? `Shared at ${status.tailscale.url}`
                  : `Share at ${status.tailscale.url} with a trusted certificate.`}
            </p>
          </div>
          <Button size="sm" variant={tailscaleShared ? 'ghost' : 'outline'} disabled={busy || !status.tailscale.running}
            onClick={() => void run(() => sdkClient.http.remoteAccess.setTailscale(!tailscaleShared))}>
            {tailscaleShared ? 'Stop' : 'Set up'}
          </Button>
        </div>
      )}

      {(status.addresses.length > 0 || (status.listenOnNetwork && status.suggestions.length > 0)) && (
        <div className="space-y-1">
          {status.addresses.map((item) => (
            <div key={item.url} className="flex items-center gap-2 rounded-lg border px-3 py-1.5">
              <code className="min-w-0 flex-1 truncate text-xs">{item.url}</code>
              <Badge variant="secondary">{KIND_LABELS[item.kind]}</Badge>
              {item.source === 'saved' ? (
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => void run(() => sdkClient.http.remoteAccess.removeAddress(item.url))}>Remove</Button>
              ) : (
                <span className="text-xs text-muted-foreground" title="Set by PROKOPAI_ALLOWED_HOSTS">env</span>
              )}
            </div>
          ))}
          {status.listenOnNetwork && status.suggestions.map((item) => (
            <div key={item.url} className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground">
              <code className="min-w-0 flex-1 truncate text-xs">{item.url}</code>
              <Badge variant="outline">{KIND_LABELS[item.kind]}</Badge>
            </div>
          ))}
        </div>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!address.trim()) return;
          void run(() => sdkClient.http.remoteAccess.addAddress(address)).then((ok) => { if (ok) setAddress(''); });
        }}
      >
        <Input value={address} onChange={(event) => setAddress(event.target.value)} disabled={busy}
          placeholder="Add an address, e.g. https://prokop.example.com" aria-label="Address other devices use" />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !address.trim()}>Add</Button>
      </form>

      {error && <SettingsError>{error}</SettingsError>}
    </div>
  );
}
