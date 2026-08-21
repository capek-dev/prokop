import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Unplug, Copy, Check, ClipboardPaste, RefreshCw } from 'lucide-react';
import type { ProkopaiClient, ProviderStatus } from '@prokopai/sdk';
import { useProvidersQuery, useConnectProvider, useDisconnectProvider, useCompleteOAuth } from '@/hooks/queries';
import { Button } from '@/components/ui/button';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

interface PendingAuth {
  providerId: string;
  flowId: string;
  redirectUri: string;
  authorizationUrl: string;
}

export function OAuthProvidersPanel({ sdkClient }: PanelProps) {
  const { data: providersData, isLoading: loading, isFetching, refetch } = useProvidersQuery(sdkClient);
  const connectMut = useConnectProvider(sdkClient);
  const disconnectMut = useDisconnectProvider(sdkClient);
  const completeMut = useCompleteOAuth(sdkClient);
  const providers: ProviderStatus[] = providersData?.providers ?? [];
  const [error, setError] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const [copiedAuth, setCopiedAuth] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [completing, setCompleting] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleConnect = useCallback(async (providerId: string) => {
    setConnectingId(providerId);
    setPendingAuth(null);
    setError(null);
    try {
      const data = await connectMut.mutateAsync({ providerId });
      if (data.authorizationUrl && data.flowId) {
        const pending: PendingAuth = {
          providerId,
          flowId: data.flowId,
          redirectUri: data.redirectUri || '',
          authorizationUrl: data.authorizationUrl,
        };
        setPendingAuth(pending);

        // Start a localhost listener to capture the redirect
        if (data.redirectStrategy === 'client_redirect' || !data.redirectStrategy) {
          startLocalhostListener(pending, data.redirectUri || '');
        }

        // Open the authorization URL in a new tab
        window.open(data.authorizationUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect provider');
    } finally {
      setConnectingId(null);
    }
  }, [connectMut]);

  const startLocalhostListener = useCallback((pending: PendingAuth, redirectUri: string) => {
    try {
      const url = new URL(redirectUri);
      const port = parseInt(url.port, 10);
      if (!port || isNaN(port)) return;

      // We can't start a real HTTP server in the browser.
      // The localhost listener only works in Electron / native environments.
      // For web browsers, the user will need to use manual paste.
      // This is a no-op for SPA — the fallback is manual paste.
    } catch {
      // Invalid redirect URI, fall through to manual paste
    }
  }, []);

  const handlePasteSubmit = useCallback(async () => {
    if (!pendingAuth || !pasteUrl.trim()) return;

    setCompleting(true);
    setError(null);
    try {
      let code: string;
      let state: string;

      // Parse the pasted URL — could be full URL, query string, or just the code
      const trimmed = pasteUrl.trim();
      try {
        const parsed = new URL(trimmed);
        code = parsed.searchParams.get('code') || '';
        state = parsed.searchParams.get('state') || '';
      } catch {
        // Maybe it's a query string like ?code=...&state=...
        if (trimmed.includes('code=')) {
          const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed : `?${trimmed}`);
          code = params.get('code') || '';
          state = params.get('state') || '';
        } else {
          // Bare code value
          code = trimmed;
          state = '';
        }
      }

      if (!code) {
        setError('Could not extract authorization code from the pasted URL');
        return;
      }

      const result = await completeMut.mutateAsync({
        flowId: pendingAuth.flowId,
        code,
        state,
        redirectUri: pendingAuth.redirectUri,
      });

      if (result.success) {
        setPendingAuth(null);
        setPasteUrl('');
      } else {
        setError(result.error || 'OAuth completion failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete OAuth');
    } finally {
      setCompleting(false);
    }
  }, [pendingAuth, pasteUrl, completeMut]);

  const handleCopyAuthUrl = useCallback(async () => {
    if (!pendingAuth) return;
    try {
      await navigator.clipboard.writeText(pendingAuth.authorizationUrl);
      setCopiedAuth(true);
      setTimeout(() => setCopiedAuth(false), 2000);
    } catch {
      // silently fail
    }
  }, [pendingAuth]);

  const handleDisconnect = useCallback(async (providerId: string) => {
    setError(null);
    try {
      await disconnectMut.mutateAsync(providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect provider');
    }
  }, [disconnectMut]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    try {
      const result = await refetch({ throwOnError: true });
      if (result.error) {
        throw result.error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh providers');
    }
  }, [refetch]);

  useEffect(() => {
    if (!pendingAuth || completing) return;
    const provider = providers.find((p) => p.provider === pendingAuth.providerId);
    if (provider?.connected) {
      toast.success(`${provider.displayName || provider.provider} connected`);
      setPendingAuth(null);
      setPasteUrl('');
      setError(null);
    }
  }, [pendingAuth, completing, providers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Connect subscription-based providers using OAuth. No API keys needed.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isFetching}
        >
          <RefreshCw className={isFetching ? 'animate-spin' : ''} data-icon="inline-start" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      {providers.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No OAuth providers available.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {providers.map((provider) => (
            <div key={provider.provider} className="rounded-lg border p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`size-2 rounded-full ${provider.reauthRequired ? 'bg-amber-500' : provider.connected ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                  <span className="text-sm font-medium">
                    {provider.displayName || provider.provider}
                  </span>
                </div>
                {provider.reauthRequired ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400">Reauthentication required</span>
                ) : provider.connected ? (
                  <span className="text-xs text-muted-foreground">Connected</span>
                ) : null}
              </div>

              {provider.error && (
                <p className={`text-xs ${provider.reauthRequired ? 'text-amber-700 dark:text-amber-300' : 'text-destructive'}`}>
                  {provider.error}
                </p>
              )}

              {provider.connected && provider.connectedAt && (
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(provider.connectedAt).toLocaleDateString()}
                </p>
              )}

              <div className="flex gap-2">
                {!provider.connected && !provider.reauthRequired && pendingAuth?.providerId !== provider.provider && (
                  <Button
                    size="sm"
                    onClick={() => handleConnect(provider.provider)}
                    disabled={connectingId === provider.provider}
                  >
                    {connectingId === provider.provider ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : null}
                    Connect
                  </Button>
                )}

                {provider.reauthRequired && pendingAuth?.providerId !== provider.provider && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleConnect(provider.provider)}
                      disabled={connectingId === provider.provider}
                    >
                      {connectingId === provider.provider ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Reconnect
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(provider.provider)}
                    >
                      <Unplug className="size-3" />
                      <span className="hidden sm:inline">Disconnect</span>
                    </Button>
                  </>
                )}

                {provider.connected && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDisconnect(provider.provider)}
                  >
                    <Unplug className="size-3" />
                    <span className="hidden sm:inline">Disconnect</span>
                  </Button>
                )}
              </div>

              {pendingAuth?.providerId === provider.provider && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Open this URL in your browser to authenticate:
                    </p>
                    <div className="rounded-md bg-muted p-2">
                      <a
                        href={pendingAuth.authorizationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-500 underline break-all"
                      >
                        {pendingAuth.authorizationUrl}
                      </a>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyAuthUrl}
                    >
                      {copiedAuth ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copiedAuth ? 'Copied' : 'Copy URL'}
                    </Button>
                  </div>

                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      After authenticating, paste the redirect URL from your browser:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={pasteUrl}
                        onChange={(e) => setPasteUrl(e.target.value)}
                        placeholder="http://localhost:1455/oauth/.../callback?code=...&state=..."
                        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs font-mono"
                      />
                      <Button
                        size="sm"
                        onClick={handlePasteSubmit}
                        disabled={!pasteUrl.trim() || completing}
                      >
                        {completing ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <ClipboardPaste className="size-3" />
                        )}
                        Submit
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
