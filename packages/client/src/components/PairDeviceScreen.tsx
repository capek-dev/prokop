import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  PairingError,
  redeemPairingCode,
  requestDeviceAccess,
  waitForAccessDecision,
  type SavedServer,
} from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { describeThisDevice } from '@/lib/deviceIdentity';

type ApprovalState =
  | { kind: 'requesting' }
  | { kind: 'waiting'; matchCode: string }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'failed'; message: string };

interface PairDeviceScreenProps {
  server: Pick<SavedServer, 'name' | 'url'>;
  onPaired: (token: string) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof PairingError) return error.message;
  if (error instanceof TypeError) return 'Could not reach the server. Check that it is running and reachable from this device.';
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shown when this device is not paired with a server. Asks the server's owner
 * for approval right away (no extra click); a pairing code is the alternative.
 */
export function PairDeviceScreen({ server, onPaired }: PairDeviceScreenProps) {
  const [approval, setApproval] = useState<ApprovalState>({ kind: 'requesting' });
  const [attempt, setAttempt] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  useEffect(() => {
    const controller = new AbortController();
    setApproval({ kind: 'requesting' });
    void (async () => {
      try {
        const ticket = await requestDeviceAccess(server.url, describeThisDevice());
        if (controller.signal.aborted) return;
        setApproval({ kind: 'waiting', matchCode: ticket.matchCode });
        // A dropped stream (sleep, network change) resumes; the server keeps an approved token.
        for (;;) {
          try {
            const decision = await waitForAccessDecision(server.url, ticket, controller.signal);
            if (decision.status === 'approved') onPairedRef.current(decision.token);
            else setApproval({ kind: decision.status });
            return;
          } catch (error: unknown) {
            if (controller.signal.aborted) return;
            if (!(error instanceof PairingError && error.code === 'stream_closed')) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        // Opened from another machine's app: approval only works on this server's own address.
        if (error instanceof PairingError && error.code === 'foreign-origin') {
          setApproval({ kind: 'failed', message: 'Enter a pairing code from that machine: Settings → Devices → Pair a device, or run prokop pair there.' });
          setShowCode(true);
          return;
        }
        setApproval({ kind: 'failed', message: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [server.url, attempt]);

  const submitCode = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    setRedeeming(true);
    setCodeError(null);
    try {
      const issued = await redeemPairingCode(server.url, { code, ...describeThisDevice() });
      onPairedRef.current(issued.token);
    } catch (error: unknown) {
      setCodeError(errorMessage(error));
    } finally {
      setRedeeming(false);
    }
  }, [code, server.url]);

  const retry = () => setAttempt((value) => value + 1);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="app-drag-strip" aria-hidden="true" />
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Connect to {server.name}</h1>
          <p className="text-sm text-muted-foreground">This device isn&apos;t paired with this server yet.</p>
        </div>

        {approval.kind === 'requesting' && (
          <p role="status" className="text-sm text-muted-foreground">Asking for access…</p>
        )}
        {approval.kind === 'waiting' && (
          <div role="status" className="space-y-3">
            <p className="text-sm">Approve this device on the computer running Prokop.</p>
            <p className="font-mono text-3xl tracking-[0.3em]" aria-label={`Match code ${approval.matchCode}`}>
              {approval.matchCode}
            </p>
            <p className="text-xs text-muted-foreground">The same code appears in the approval prompt.</p>
          </div>
        )}
        {(approval.kind === 'denied' || approval.kind === 'expired' || approval.kind === 'failed') && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {approval.kind === 'denied' ? 'The request was declined.'
                : approval.kind === 'expired' ? 'The request expired before anyone approved it.'
                  : approval.message}
            </p>
            <Button size="sm" onClick={retry}>Ask again</Button>
          </div>
        )}

        {showCode ? (
          <form onSubmit={(event) => void submitCode(event)} className="space-y-2 text-left">
            <label htmlFor="pairing-code" className="text-sm font-medium">Pairing code</label>
            <div className="flex gap-2">
              <Input id="pairing-code" value={code} autoFocus autoComplete="off" autoCapitalize="characters"
                placeholder="XXXX-XXXX-XXXX" className="font-mono"
                onChange={(event) => { setCode(event.target.value); setCodeError(null); }} />
              <Button type="submit" disabled={redeeming || !code.trim()}>{redeeming ? 'Pairing…' : 'Pair'}</Button>
            </div>
            {codeError && <p role="alert" className="text-sm text-destructive">{codeError}</p>}
            <p className="text-xs text-muted-foreground">Run <code>prokop pair</code> on the server, or open Settings → Devices there.</p>
          </form>
        ) : (
          <button type="button" className="text-sm underline underline-offset-4" onClick={() => setShowCode(true)}>
            Use a pairing code instead
          </button>
        )}

        <Link to="/" search={{ select: true }} replace className="block text-sm text-muted-foreground underline underline-offset-4">
          Back to Server Selection
        </Link>
      </div>
    </div>
  );
}
