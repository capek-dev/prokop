import { useCallback, useEffect, useState } from 'react';
import { renderSVG } from 'uqr';
import type {
  AccessStatus,
  CreatePairingCodeResponse,
  PairedDevice,
  PendingAccessRequest,
  ProkopaiClient,
} from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SettingsEmpty, SettingsError, SettingsLoading } from './SettingsPrimitives';
import { RemoteAccessSection } from './RemoteAccessSection';

interface DevicesPanelProps {
  sdkClient: ProkopaiClient | null;
}

function lastSeen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function PairingCodeCard({ pairing, onDone }: { pairing: CreatePairingCodeResponse; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing.expiresAt, onDone]);

  const link = pairing.links[0];
  if (!link) {
    return (
      <div className="space-y-2 rounded-lg border p-3 text-sm">
        <p>Other devices can&apos;t reach Prokop yet.</p>
        <p className="text-muted-foreground">Turn on remote access above, then pair again.</p>
      </div>
    );
  }

  const qr = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(link, { border: 2 }))}`;
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border p-4 text-center">
      <img src={qr} alt="Pairing QR code" className="size-44 rounded bg-white p-1" />
      <p className="text-sm">Scan with the other device&apos;s camera, or open the link there.</p>
      <div className="w-full space-y-1">
        {pairing.links.map((item) => (
          <code key={item} className="block break-all text-xs text-muted-foreground">{item}</code>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Code <span className="font-mono text-foreground">{pairing.code}</span> works once and expires in 5 minutes.
      </p>
      <Button variant="ghost" size="sm" onClick={onDone}>Done</Button>
    </div>
  );
}

/**
 * Devices paired with this server. The server's own machine approves requests,
 * creates pairing codes, and revokes devices; a paired device can only unpair itself.
 */
export function DevicesPanel({ sdkClient }: DevicesPanelProps) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [requests, setRequests] = useState<PendingAccessRequest[]>([]);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairing, setPairing] = useState<CreatePairingCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sdkClient) return;
    try {
      const current = await sdkClient.http.access.status();
      setStatus(current);
      if (current.admin) {
        const overview = await sdkClient.http.access.overview();
        setRequests(overview.requests);
        setDevices(overview.devices);
      }
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [sdkClient]);

  useEffect(() => {
    void load();
    if (!sdkClient) return;
    const refresh = () => void load();
    // Pushed by the server whenever requests or devices change; no polling.
    sdkClient.on('access.changed', refresh);
    return () => { sdkClient.off('access.changed', refresh); };
  }, [sdkClient, load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const closePairing = useCallback(() => setPairing(null), []);

  if (!sdkClient) return <SettingsEmpty>Connect to a server to manage devices.</SettingsEmpty>;
  if (!status) return error ? <SettingsError className="m-4">{error}</SettingsError> : <SettingsLoading />;

  if (!status.admin) {
    return (
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <p className="text-sm">
          {status.device ? <>This device is paired as <span className="font-medium">{status.device.label}</span>.</> : 'This device is paired.'}
          {' '}Devices are managed on the computer running Prokop.
        </p>
        {status.device && (
          <div>
            <Button variant="outline" size="sm" disabled={busy !== null}
              onClick={() => void run('self', () => sdkClient.http.access.revokeDevice(status.device!.id))}>
              Unpair this device
            </Button>
          </div>
        )}
        {error && <SettingsError>{error}</SettingsError>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <RemoteAccessSection sdkClient={sdkClient} />

      <Separator />
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-sm font-medium">Pair a device</Label>
            <p className="text-sm text-muted-foreground">Use Prokop from your phone or another computer. This computer never needs to pair.</p>
          </div>
          {!pairing && (
            <Button size="sm" disabled={busy !== null}
              onClick={() => void run('pair', async () => setPairing(await sdkClient.http.access.createPairingCode()))}>
              Pair a device
            </Button>
          )}
        </div>
        {pairing && <PairingCodeCard pairing={pairing} onDone={closePairing} />}
      </div>

      {requests.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label className="text-sm font-medium">Waiting for approval</Label>
            {requests.map((request) => (
              <div key={request.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{request.label}</span>
                <span className="font-mono text-sm text-muted-foreground" title="Should match the code on the other device">
                  {request.matchCode}
                </span>
                <Button size="sm" disabled={busy !== null}
                  onClick={() => void run(request.id, () => sdkClient.http.access.approve(request.id))}>Allow</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null}
                  onClick={() => void run(request.id, () => sdkClient.http.access.deny(request.id))}>Deny</Button>
              </div>
            ))}
          </div>
        </>
      )}

      <Separator />
      <div className="space-y-2">
        <Label className="text-sm font-medium">Paired devices</Label>
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other devices are paired.</p>
        ) : devices.map((device) => (
          <div key={device.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <span className="min-w-0 truncate text-sm font-medium">{device.label}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">Last seen {lastSeen(device.lastSeenAt)}</span>
            <Button size="sm" variant="ghost" disabled={busy !== null}
              onClick={() => void run(device.id, () => sdkClient.http.access.revokeDevice(device.id))}>Remove</Button>
          </div>
        ))}
      </div>
      {error && <SettingsError>{error}</SettingsError>}
    </div>
  );
}
