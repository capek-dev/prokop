// packages/client/src/components/FirstServerScreen.tsx
import { useState } from 'react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { normalizeServerUrl } from '@/config/auth';
import { useServerContext } from '@/contexts/ServerContext';
import { checkServerReachable, getDefaultServerUrl } from '@/lib/validateServerAuth';
import { PairingError, readPairingLink, redeemPairingCode } from '@prokopai/sdk';
import { describeThisDevice } from '@/lib/deviceIdentity';

interface FirstServerScreenProps {
  error?: string;
}

export default function FirstServerScreen({ error }: FirstServerScreenProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const { addServer, servers } = useServerContext();
  const [name, setName] = useState('');
  const [url, setUrl] = useState(getDefaultServerUrl);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (!trimmedName) {
      setLocalError('Please enter a server name');
      return;
    }

    if (servers.some((s) => s.name.toLowerCase() === trimmedName.toLowerCase())) {
      setLocalError(`A server named "${trimmedName}" already exists`);
      return;
    }

    if (!trimmedUrl) {
      setLocalError('Please enter a server URL');
      return;
    }

    setLocalError(null);
    setIsValidating(true);

    // A pasted pairing link (`prokop pair` or Settings → Devices) pairs this device directly.
    const pairingLink = readPairingLink(trimmedUrl);
    if (pairingLink) {
      try {
        const { token: deviceToken } = await redeemPairingCode(pairingLink.serverUrl, {
          code: pairingLink.code,
          ...describeThisDevice(),
        });
        const pairedServer = addServer(trimmedName, normalizeServerUrl(pairingLink.serverUrl), deviceToken);
        navigate({ to: '/server/$serverId', params: { serverId: pairedServer.id } });
      } catch (err: unknown) {
        setLocalError(err instanceof PairingError ? err.message : 'Could not reach the server in this pairing link.');
      } finally {
        setIsValidating(false);
      }
      return;
    }

    const result = await checkServerReachable(trimmedUrl);

    setIsValidating(false);

    if (!result.success) {
      setLocalError(result.error ?? 'Connection failed');
      return;
    }

    // A machine that requires pairing shows the pairing screen when opened.
    const newServer = addServer(trimmedName, normalizeServerUrl(trimmedUrl));
    navigate({ to: '/server/$serverId', params: { serverId: newServer.id } });
  };

  const handleGoBack = () => {
    if (router.history.length > 1) {
      router.history.back();
    } else {
      navigate({ to: '/', search: { select: true } });
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-background dark:bg-gradient-to-br dark:from-muted dark:via-background dark:to-muted p-4">
      <div className="app-drag-strip" aria-hidden="true" />
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4 text-center border-b border-border relative">
            <button
              type="button"
              onClick={handleGoBack}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold text-foreground">Add Server</h1>
            <p className="text-muted-foreground mt-1">Connect to a Prokopai server</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Server Name Input */}
            <div className="space-y-2">
              <label htmlFor="serverName" className="text-sm font-medium text-foreground">
                Server Name
              </label>
              <input
                id="serverName"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setLocalError(null);
                }}
                placeholder="Production"
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
              />
            </div>

            {/* Server URL Input */}
            <div className="space-y-2">
              <label htmlFor="serverUrl" className="text-sm font-medium text-foreground">
                Server URL
              </label>
              <input
                id="serverUrl"
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setLocalError(null);
                }}
                placeholder="localhost:8742 or a pairing link"
                className="w-full px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-colors"
              />
            </div>

            {/* Error Message */}
            {(localError || error) && (
              <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                {localError || error}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isValidating}
              className="w-full py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isValidating ? 'Connecting...' : 'Add Server'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
