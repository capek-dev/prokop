import { useState, useEffect } from 'react';
import { Loader2, Unplug, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ProviderStatus } from '@prokopai/sdk';

interface ProviderCardProps {
  provider: ProviderStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function ProviderCard({ provider, onConnect, onDisconnect }: ProviderCardProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (provider.error || provider.connected) {
      setLoading(false);
    }
  }, [provider.error, provider.connected]);

  useEffect(() => {
    if (provider.authorizationUrl) {
      setLoading(false);
    }
  }, [provider.authorizationUrl]);

  const handleConnect = () => {
    setLoading(true);
    onConnect();
  };

  const handleDisconnect = () => {
    onDisconnect();
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`size-2 rounded-full ${provider.connected ? 'bg-green-500' : 'bg-muted-foreground'}`} />
          <span className="text-sm font-medium">
            {provider.displayName || provider.provider}
          </span>
        </div>
        {provider.connected && (
          <span className="text-xs text-muted-foreground">
            Connected
          </span>
        )}
      </div>

      {provider.error && (
        <p className="text-xs text-destructive">{provider.error}</p>
      )}

      {provider.connected && provider.connectedAt && (
        <p className="text-xs text-muted-foreground">
          Connected {new Date(provider.connectedAt).toLocaleDateString()}
        </p>
      )}

      <div className="flex gap-2">
        {!provider.connected && !provider.authorizationUrl && (
          <Button
            size="sm"
            onClick={handleConnect}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" data-icon="inline-start" />
            ) : null}
            Connect
          </Button>
        )}

        {!provider.connected && provider.authorizationUrl && (
          <div className="flex flex-col gap-2">
            <a
              href={provider.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-blue-500 underline break-all"
            >
              {provider.authorizationUrl}
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(provider.authorizationUrl!);
                } catch {
                  // silently fail
                }
              }}
            >
              <Copy className="size-3" data-icon="inline-start" />
              Copy URL
            </Button>
          </div>
        )}

        {provider.connected && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDisconnect}
          >
            <Unplug className="size-3" data-icon="inline-start" />
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
