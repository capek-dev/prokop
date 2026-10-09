import { useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { PairingError, redeemPairingCode } from '@prokopai/sdk';
import { findServerByUrl } from '@/config/servers';
import { useServerContext } from '@/contexts/ServerContext';
import { describeThisDevice } from '@/lib/deviceIdentity';

/**
 * `/pair#code=...` opened from a QR code or `prokop pair` link. The page is
 * served by the server being paired, so its origin is that server. The code
 * stays in the fragment and is removed from history before redeeming.
 */
function PairRoute() {
  const navigate = useNavigate();
  const { isHydrated, addServer, editServer } = useServerContext();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!isHydrated || started.current) return;
    started.current = true;
    const code = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('code')?.trim() ?? '';
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (!code) {
      setError('This pairing link has no code. Create a new one on the server.');
      return;
    }

    const serverUrl = window.location.origin;
    void redeemPairingCode(serverUrl, { code, ...describeThisDevice() })
      .then(({ token }) => {
        // Read storage, not render state: first-run discovery may have saved this origin meanwhile.
        const existing = findServerByUrl(serverUrl);
        const serverId = existing?.id ?? addServer(window.location.hostname, serverUrl, token).id;
        if (existing) editServer(existing.id, { token });
        void navigate({ to: '/server/$serverId', params: { serverId }, replace: true });
      })
      .catch((cause: unknown) => {
        setError(cause instanceof PairingError ? cause.message : 'Could not reach the server to pair this device.');
      });
  }, [addServer, editServer, isHydrated, navigate]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4 text-foreground">
      <div className="app-drag-strip" aria-hidden="true" />
      <div className="max-w-sm space-y-3 text-center">
        {error ? (
          <>
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Link to="/" search={{ select: true }} replace className="text-sm underline underline-offset-4">Continue</Link>
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">Pairing this device…</p>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/pair')({
  component: PairRoute,
});
